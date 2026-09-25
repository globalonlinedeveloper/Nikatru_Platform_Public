#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-ops-register.mjs — the operations register is COMPLETE, BOUNDED and
// still describes the tree it claims to describe.
//
// [pipeline O-1] "Every failure the factory can suffer has a named detector,
// response and cadence." Stage 14 audited its own twenty-one acceptance criteria
// and found EIGHTEEN that cannot fail — the largest concentration in the
// pipeline — and every one of them for the same reason: they quantify over an
// operations register that did not exist. `ls tooling/ops` returned "No such
// file or directory", so eighteen criteria ranged over the empty set and all
// eighteen reported clean. An undefined right-hand side rejects nothing.
//
// This guard is what makes the register mean something. Creating the file was
// never the hard part; the hard part is that a hand-written register drifts away
// from the tree silently, and a register that no longer matches reality is worse
// than none, because it reads as coverage.
//
// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE IS A RELATIONSHIP, NEVER A COUNT. This is the single rule the file
// exists to obey, and this repo has paid for it repeatedly.
//
//   watched workflows  ≡  .github/workflows/*.yml       (both directions)
//   cron duties        ⊇  every `triggers.crons` in every wrangler config
//   rows               ⊇  _requiredCoverage.ids          (the external half)
//
// "At least twelve rows" would be a floor somebody lowers. The temptation is
// acute here precisely BECAUSE the register is hand-written — so nothing in this
// guard is a threshold on the register's own size.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ WHAT THIS REGISTER DELIBERATELY DOES **NOT** CONTAIN: HOSTNAMES.
//
// The first draft of this file carried six `surface` rows — one per live
// hostname — each restating which GlitchTip monitor watches it and which of them
// are unwatched. Every one of those facts is already derived and enforced by
// [11]E-9's `tooling/monitor-register.json` + `assert-monitor-coverage.mjs`,
// whose derivation is STRICTLY WIDER than the one here was (Worker custom
// domains ∪ the app catalogue ∪ every site's own canonical URL, against custom
// domains alone). Two registers of the same set is precisely the drift this repo
// exists to prevent: they would have disagreed the first time a site canonical
// moved, and the monitor register's own header already says
// "[14]O-2 must CONSUME this register rather than re-enumerate the hostnames."
//
// So the surface rows were CUT, and what replaces them is a seam that fails:
// `_delegated` names the register that owns hostnames, and this guard refuses to
// run if that file is absent, unparseable or empty. Deleting the monitor
// register therefore reddens BOTH guards instead of quietly leaving hostnames
// owned by nobody — which is what "delegated" means when it is worth anything.
//
// BOTH DIRECTIONS MATTER, and the second one is the one that gets forgotten. A
// duty row anchored at a workflow file that has been deleted is COVERAGE LOST,
// not a harmless stale line: the register would keep asserting that a duty is
// performed by a mechanism that is gone. That is the exact failure
// check-migrations.mjs shipped with — it silently dropped from five files to
// four and printed PASS.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ESCAPE HATCHES, AND WHY EACH ONE COSTS SOMETHING
//
//   `cadence: on-demand`   requires a non-empty `why`, and the COUNT PRINTS on
//                          every run. In the drafted acceptance this single word
//                          disabled the staleness limb per row, so a register of
//                          all-on-demand rows was green.
//   `cadence: trigger`     requires a named `trigger` event. Added because the
//                          parked fresh-host drill is neither on a clock nor
//                          on-demand: it fires when the next machine is set up.
//                          A third honest state beats a dishonest second one.
//   `ownerGated: true`     requires a non-empty `ownerGap`, and every gap is
//                          PRINTED IN FULL on every run. It never blocks —
//                          CLAUDE.md's C-6 rule: a guard that blocks all of CI
//                          on work only the owner can do gets disabled, and a
//                          disabled guard checks nothing.
//   `degradedUntil`        a DATED tripwire for a gap another stage owns:
//                          printed until the lead window, RED inside it, hard
//                          failure after the date. The
//                          assert-platform-proof-fresh.mjs precedent. A gap that
//                          only ever prints is one nobody closes. Requires
//                          `degradedLeadDays` — see below.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHY `degradedLeadDays` IS MANDATORY — the 2026-08-04 finding.
//
// The first dated tripwire in this register, `revert.mitigation.force-update`,
// was armed on 2026-08-02 for 2026-09-01 with NO LEAD WINDOW AT ALL. Its
// behaviour was binary: one `⬜` line among forty every run, then — with nothing
// in between and nothing escalating — a hard failure that reddens `ci-gate` on
// EVERY PUSH TO EVERY BRANCH, including branches touching nothing near it. The
// print at T-27 days was byte-identical to the print at T-1.
//
// Two things follow from that shape, and both happened:
//
//  1. NOBODY IS WARNED. "Visible" meant one line in a wall of prints that is
//     mostly owner-gated gaps somebody has already decided not to act on today.
//     A signal that never changes is a signal nobody reads.
//  2. THE PREMISE ROTS UNWATCHED. That row's stated response was "Stage 9
//     restores the PWA update strategy". Stage 9 landed on 2026-08-03 — EIGHT
//     HOURS after the tripwire was armed — and did NOT restore it, because
//     [ADR 023] (LOCKED 2026-07-31) had already decided `--pwa-strategy=none`
//     deliberately and explicitly rejected guarding the flag. So the countdown
//     was toward an event that had already happened and resolved the other way,
//     and the only moves available on 2026-09-01 would have been to MOVE THE
//     DATE — the "deadline somebody extends" this very field exists to prevent —
//     or to delete the row.
//
// The lead window is the repair, and it is not a new idea in this file: the
// `expiring` kind has always failed INSIDE its own `leadDays` rather than on the
// day (see the `daysLeft <= r.leadDays` limb below). A dated tripwire is an
// expiry on a gap; it gets the same treatment. The guard does not choose the
// number — the row's author does, and must, because only they know how long the
// remaining work takes. What the guard enforces is that a number EXISTS and is
// positive: a tripwire with no lead window is the shape described above.
//
// ⬜ THE COUNT OF ARMED TRIPWIRES PRINTS ON EVERY RUN. Zero and three must never
// read alike — if this register ever holds no dated tripwire, the limb below
// ranges over the empty set, and an empty domain that prints nothing is this
// repository's single most repeated defect.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO CHECKS THAT ARE NOT SCHEMA VALIDATION, i.e. the ones worth reading:
//
// 1. O-8 — `path: "cannot-revert"` REQUIRES A NAMED MITIGATION THAT IS ITSELF A
//    ROW WITH ITS OWN CADENCE. Without this, marking every surface cannot-revert
//    made the criterion green. With it, "we have a kill switch" stops being an
//    assertion and becomes a row that can go stale, and the cannot-revert COUNT
//    prints every run so the set cannot grow quietly.
//
// 2. O-14 — THE INTERSECTION IS COMPUTED OVER TWO INDEPENDENTLY WRITTEN LISTS.
//    A `failure-mode` row names the providers it TAKES DOWN; the `recovery-path`
//    row it points at names the providers IT NEEDS. The guard intersects them.
//    The drafted version compared two sets written by the same hand in the same
//    row, so a row declaring an empty dependency set could never intersect
//    anything — the sharpest cannot-fail instance in the whole stage. Both lists
//    resolve against a FIXED VOCABULARY, never free text, and a row that
//    resolves to NO provider FAILS as "cannot be checked" rather than passing.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE ONE BLIND SPOT, STATED RATHER THAN PAPERED OVER. `Private/` is
// gitignored and INVISIBLE TO CI, and `nikatru/` — the shared business brain
// [ADR 054] moved to a sibling repository — is not even on the disk CI checks
// out. A row may anchor at either; the runbooks legitimately live in Private/runbooks/,
// and the GST LUT, the Awfis lease and the kill-or-keep review now anchor in the
// brain. This guard CANNOT check that such an anchor exists, and it says so out
// loud with a count on every run instead of pretending the check happened.
// Anchors anywhere else MUST exist. This is why the register itself is in the
// public tree: a register under Private/ would be unenforceable, which is
// precisely what blocked four stage-8 increments.
//
// 🔴 THE PREFIX LIST IS THE WHOLE EXEMPTION, SO IT MUST NOT GROW CASUALLY. Each
// entry buys a row the right to name a substrate nothing verifies. Two are
// justified because each is a REPOSITORY BOUNDARY this repo cannot cross; a
// third would need the same argument, not merely a convenient path.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ WHAT THESE SCANS DO NOT WALK INTO, AND THE RULE THAT DECIDES IT.
//
// Reproduced on `main` 2026-08-02: with agent worktrees present under
// `.claude/worktrees/` — which this repo creates one of per agent task — this
// guard exited 1 with SIXTEEN problems, every one of the form
//
//     .claude/worktrees/agent-<id>/services/platform/wrangler.jsonc declares
//     `triggers.crons` and has no `duty` row …
//
// Both walks below were descending into NESTED FULL COPIES OF THE REPOSITORY
// and reading their wrangler configs as this tree's own. CI creates no
// worktrees, so CI stayed green and only a developer machine went red — and a
// guard that cries wolf exactly where a human is watching is a guard that gets
// disbelieved, which is a slower way of not having one.
//
// THE RULE, implemented once in `tooling/ci/tree-walk.mjs` and applied by every
// `listDir` call below: an entry is not part of the tree under test if it is a
// directory containing a `.git` entry — FILE or directory; a worktree's is a
// file, and that is the case that bit — or if it is named `.claude`. The root of
// a walk is never itself excluded, so pointing this guard at a checkout (which
// the real repository always is) still scans it in full. Anchoring on the
// literal path `.claude/worktrees/` was rejected: it would leave submodules,
// stray clones and `git worktree add` into the tree all still wrong.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE SIX INVARIANTS OF A LIVE VERDICT — ADDED 2026-09-11. Each is PROVED by a
// named case in tooling/ci/test/ops-register.test.mjs ("the 2026-09-11 freeze,
// replayed"), which replays run 34546423386's exact answers from
// tooling/ci/test/fixtures/ops-freeze-2026-09-11.json through this file.
//
// A LIVE verdict is read off the world rather than off this tree: a run history,
// a job or step conclusion, a heartbeat, a monitor. On 2026-09-11 all six broke
// at once: eight problems, every pull request blocked by main's history, and no
// merge order that could break it (FINDING-permanent-freeze-2026-09-11).
//
//  INV1 — A VERDICT MAY STOP SHIPPING, NEVER STOP FIXING. On a proposal event
//         (pull_request, pull_request_target, merge_group) in a guard host whose
//         own `on:` declares it, every live verdict PRINTS in full with its remedy
//         and does not block; no verdict about history can block the dispatch that
//         clears it either (INV4). A structural finding about the register still
//         blocks: it is a property of the proposal. `hostPolicy`.
//  INV2 — SHIPPING STILL STOPS. Every deploy and submit lane runs
//         tooling/ci/assert-gate-passed.mjs, which refuses unless `ci-gate` passed
//         for its commit; `ci-gate` on a default-branch commit comes from ci.yml's
//         PUSH run, an ENFORCING host in which every live verdict still blocks
//         (bar a lane whose own recovery needs that gate). ops-watch is enforcing
//         too, and is the page. The deploy-side check IS the push-host enforcement.
//  INV3 — DUTIES ARE INDEPENDENT. A run-history row names the `unit` that performs
//         its duty — "run", { jobs } or { job, step } — and is judged by that
//         unit's own conclusion from /actions/runs/{id}/jobs. "run" is legal only
//         for a workflow no other row reads and that does not run this guard.
//         `checkRunUnits`, `unitConclusion`.
//  INV4 — NO HOST REQUIRES ITSELF. No unit may contain this guard's own verdict,
//         and in an enforcing host a live verdict whose recovery NEEDS that host
//         to be green — its own run, a lane self-gated on the check that host
//         produces, or a cycle through another host — prints with its path
//         instead of blocking. SELF, SELF-GATED and SECOND LAP were three
//         instances of this one rule. `unitNeedsHosts`, `routeLiveVerdicts`.
//  INV5 — NO WAIVER. No flag, no environment variable of this guard's own, no
//         register date and no caller-supplied argument turns a verdict off. The
//         host is the workflow ref GitHub sets, the event is the event GitHub sets
//         and is believed only when the workflow file declares it, and every
//         exemption is derived from the workflow tree and printed with its reason.
//         A flag a caller may pass is a waiver.
//  INV6 — UNREADABLE IS EXIT 2. Could-not-look is COVERAGE LOST: never 0, never 1.
//         Every structural refusal, a guard that throws, unreadable reads above
//         their ceiling, a GitHub API that answered none of the RED-SINCE reads,
//         and a branch filter that did not hold all land on exit 2.
//
// Exit codes: 0 every blocking verdict holds · 1 a finding (structural, or a live
// verdict this host blocks on) · 2 COVERAGE LOST. 2 beats 1 beats 0.
// ─────────────────────────────────────────────────────────────────────────────
// Usage:  node tooling/ci/assert-ops-register.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, extname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
// The ONE workflow parser. Four copies of it drift in the way that reports
// "clean" — which lines they can see — so [14]O-7's deploy-job derivation goes
// through the same one assert-release-provenance and assert-no-secret-defines use.
import { parseAllWorkflows, workflowEvents, shellSegments, RECORD_CALL, expandMatrixEnvironment, POST_GATE_IF, postGateJobs } from './workflow-scan.mjs';
// The ONE comment tokenizer, for the same reason as the workflow parser above.
import { stripSourceComments } from './text-reductions.mjs';
// The ONE calendar-date check. The copy that stood here read `Date.parse(s)`
// alone, and V8 parses `2026-02-31` as 3 March, so an impossible date passed
// (the PR 913 review, L2, 2026-09-24).
import { isIsoDate } from '../app-yaml/schema-validate.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/ops/register.json';
const WORKFLOW_DIR_REL = '.github/workflows';
/** The script whose PRESENCE in a job puts that job in [14]O-7's domain, held
 *  apart from `RECORD_CALL`'s reading of its ARGUMENT so the two can disagree —
 *  which is the whole of the coverage floor at the deploy-job loop below. */
const RECORD_SCRIPT = 'record-deployment.mjs';

/** Any repo-relative path a row NAMES, in the fields that make a claim about a
 *  mechanism: the detector, the record, and the thing that reads it. `Private/`
 *  is excluded because it is gitignored and CI genuinely cannot see it — that
 *  blind spot is counted and printed rather than pretended away. */
// ⚠️ THE LEADING BOUNDARY IS A LOOKBEHIND, NOT `\b`, AND A NEGATIVE TEST IS WHY.
// `\b(?:…|\.github|…)` can NEVER match `.github/...`: `\b` needs a word boundary,
// and a space followed by `.` is two non-word characters, so there is none. The
// alternative silently matched nothing for the entire workflow half of the
// domain — a check that reported ok because it was looking at an empty set.
// 🔴 `extensions` JOINED THE LIST 2026-09-05 ([ADR 067] decision 1), AND THE
// SYMPTOM IS WORTH RECORDING BECAUSE IT LOOKED LIKE A MISSING FILE. This is a
// list of TOP-LEVEL DIRECTORIES, and `extensions/` became one when the extension
// repository moved in as a subtree. Without it, a `readBy` naming
// `extensions/scripts/assert-e2e-proof-fresh.mjs` matched NOTHING — the leading
// lookbehind correctly refuses to start at `scripts/` mid-path — so the guard
// reported that a real, committed, run-every-PR freshness reader "names no
// in-tree file that exists". A root this list has not been taught about is
// indistinguishable here from a file that is not there.
const NAMED_PATH = /(?<![\w/.-])(?:tooling|\.github|services|sites|packages|apps|scripts|extensions|contracts)\/[A-Za-z0-9_.\-/]*[A-Za-z0-9_-]\.(?:mjs|js|ts|yml|yaml|json|jsonc|sql|ps1|dart|py)\b/g;

/** Prefixes a CI checkout structurally CANNOT contain, so an anchor under one of
 *  them is counted and printed rather than checked. Both are STRUCTURAL, not
 *  flags: `Private/` is the private corpus boundary (gitignored, .gitignore:23) and
 *  `nikatru/` is the shared business brain, which [ADR 054] moved to a SIBLING
 *  REPOSITORY outside this working tree entirely — so it is not merely unreadable
 *  by CI, it is not on the disk CI checks out. A boolean anybody could set would
 *  make this check optional; a prefix list cannot be set per-row. */
/* FLATTENED 2026-08-15: was `Private/company/` (deleted that day). The flatten merged company/ and
 * knowledge/ into one repo at `Private/`, so every anchor lost a path segment
 * and this prefix stopped matching any of them. MEASURED, not predicted: 21
 * register rows went red in one run — "names Private/runbooks/operations.md,
 * which is not in the tree" — because the anchors fell through to the resolve
 * branch that a CI checkout structurally cannot satisfy. Widening to `Private/`
 * restores the exemption at exactly the new boundary and no wider: `Private/` is
 * the whole gitignored corpus, which is precisely the set CI cannot see. */
const OUTSIDE_CI = ['Private/', 'nikatru/'];

/** No argument means CI's own invocation against the real repository, where the
 *  git manifest MUST be readable. A fixture root is a weaker situation and says
 *  so rather than silently skipping the cross-check. */
const scanningRealRepo = process.argv[2] === undefined;

/** Kinds whose "when was this last done" is performed BY A HUMAN, and therefore
 *  cannot be derived from any record a machine writes. Everything else must
 *  instead name a machine record whose failing value is reachable — see the XOR
 *  below, and the register's own header for why a hand-typed date on a nightly
 *  cron is the antipattern this stage exists to remove. */
const HUMAN_DATED = new Map([
  ['recovery-path', 'lastDrill'],
  ['revert', 'lastDone'],
  ['failure-mode', 'lastDone'],
]);

const RETENTION_RULES = new Set(['keep', 'ttl', 'cache', 'period', 'period-undeclared']);

/** A cadence that is a CLOCK. `trigger` and `on-demand` are the two honest ways
 *  to not be on one, and both already cost something (a named event / a written
 *  `why` plus a printed count). Used by the [14]O-10 and [14]O-4 limbs, which
 *  are both about timers that can stop without anybody noticing. */
const TIME_CADENCE = /^\d+[hd]$/;

/** [14]O-4. The literal substrate a row declares when the honest answer is that
 *  NOTHING watches its absence. It is not a hole in the schema: it is only legal
 *  alongside `ownerGated` + a written `gap`, and it is counted and printed
 *  SEPARATELY from "a watcher exists but shares the duty's host", because those
 *  are different gaps with different repairs and a single number would hide it. */
const NO_WATCHER = '(none)';

/** 🔴 EVIDENCE THAT OUTLIVES THE SESSION THAT WROTE IT — the standard
 *  tooling/ops/alarm-chains.json already sets in its own header: "a delivery
 *  record id, not the word 'verified'". A drill whose evidence is an adjective
 *  cannot be re-checked by anybody, which makes the drill field decoration of
 *  exactly the kind the field exists to replace. So the evidence must carry at
 *  least one thing a later reader can go and LOOK UP: a delivery-record UUID, a
 *  wall-clock time, an issue key (OPS-3), a GitHub issue number (#151), or a
 *  workflow run id. This is deliberately a shape test and NOT a length test — a
 *  minimum character count is a threshold somebody lowers.
 *
 *  Exported so the `_retiredRows` seam in tooling/ci/test/ops-register.test.mjs
 *  holds retirement evidence to the same shape rather than to a second regex
 *  written from the same idea — four copies of a rule drift in the way that
 *  reports clean. */
export const DURABLE_ID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\d{2}:\d{2}:\d{2}\b|\b[A-Z][A-Z0-9]+-\d+\b|#\d{2,}|\b\d{9,}\b/;

/** Carries an exit code out of `main()` to the one place that sets it. Thrown,
 *  never `process.exit()`: exiting while a fetch handle closes aborts Node on
 *  Windows with 127 for every outcome, which in a fail-closed guard is a lie in
 *  both directions. */
class GuardExit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Stops immediately rather than joining the problem list, at exit **2**
 *  (INV6): the guard did not check enough to be evidence of anything. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  throw new GuardExit(2);
};

/** 🔴 THE SAME REFUSAL, AT EXIT **2** — and the difference from `coverageLost`
 *  above is stated here rather than left to be discovered by whoever next reads
 *  an exit code out of this file.
 *
 *  The platform rule (`AGENTS.md`, and `C-COVERAGE-LOST-IS-NOT-PASS` in
 *  `platform-state/constraints.json`) is that a guard exits **2** when it did not
 *  check enough to be evidence, so that "compared nothing, found nothing wrong"
 *  cannot share an exit code with "every floor holds" — and, just as usefully,
 *  cannot share one with "a floor broke". Nine guards in `tooling/ci` already do.
 *
 *  ⏱ 2026-09-11 — THE TWO ARE NOW ONE. This file's `coverageLost` predated that
 *  convention and exited 1 at every call site; the move was recorded as a finding
 *  (REVIEW-guards-2026-09-10 #9) and is taken here, with INV6, by the unit that
 *  owns this file. The name is kept because other files' prose cites it. */
const coverageLostHard = coverageLost;

// ── jsonc, because every wrangler config in this repo is heavily commented ────
// Comments are stripped OUTSIDE string literals only. A naive `//` strip would
// eat the `//` in every "https://…" value and turn a valid config into a parse
// error that reads like a missing file.
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Every LIVE wrangler config. The brick template is excluded BY NAME and the
 *  exclusion is counted, because `tooling/bricks/**` is a mustache template
 *  whose `{{#needs_backend}}` path segments are not a deployed surface — but a
 *  silent exclusion is how a domain shrinks without anybody noticing. */
export function findWranglerConfigs(root) {
  const found = [];
  const excluded = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = listDir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'build') continue;
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (/^wrangler\.(jsonc|json|toml)$/.test(e.name)) {
        if (r.includes('bricks/')) excluded.push(r);
        else found.push(r);
      }
    }
  };
  walk(root, '');
  return { found: found.sort(), excluded: excluded.sort() };
}

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/** Comments out, so a check about BEHAVIOUR can never be satisfied by a
 *  paragraph. See the [14]O-10 limb, whose first version was satisfied by
 *  another guard's header.
 *
 *  🔴 THIS WAS TWO REGEXES AND IT SWALLOWED 103 LINES OF A REAL FILE (2026-08-07).
 *  The old body ran `/\/\*[\s\S]*?\*\//g` FIRST and blanked `//` lines second,
 *  so a `/*` sitting INSIDE a line comment was read as a block opener.
 *  `tooling/ci/assert-ceiling-budget.mjs:32` is
 *
 *      //   3. every `const NAME = <number>` in services/​*​/src/ is annotated
 *
 *  whose `services/*​/src/` opened a phantom block running to the next `*​/` —
 *  blanking lines 32–134, including the real code at :121
 *  `const CEILINGS = 'tooling/ceilings.json';`. Anything [14]O-10 asked about a
 *  reader whose mention lived in a swallowed region got a FALSE VERDICT.
 *
 *  Comments, strings and regex literals are ONE grammar and have to be walked in
 *  ONE pass. Rather than become a fourth hand-rolled copy, this delegates to
 *  text-reductions.mjs — the tokenizer nine guards already share, which carries
 *  a test for this exact case (`//` containing `/*`, added after the identical
 *  defect cost assert-platform-register.mjs 5 of its 12 route mounts).
 *
 *  ⚠️ `ext` DECIDES THE GRAMMAR, and an extension text-reductions does not know
 *  is returned VERBATIM. Every `mechanism.readBy` in the register today is .mjs
 *  or .yml — both mapped — and ops-register.test.mjs asserts both really reduce,
 *  so "unknown extension = identity" cannot silently become a no-op here. */
export const stripComments = (s, ext = '.mjs') => stripSourceComments(s, ext);

/** `8h` / `1d` / `120d` → days. Anything else is not a duration. */
export function cadenceDays(cadence) {
  const m = /^(\d+)(h|d)$/.exec(cadence ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  if (n <= 0) return null;
  return m[2] === 'h' ? n / 24 : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// [14]O-3 · THE LIMB THAT ACTUALLY READS A RECORD.
//
// 🔴 THE STATE THIS REPLACES, MEASURED 2026-08-06 ON THE OWNER'S LAPTOP:
//
//     ClaudeTranscriptBackup   LastRun 2026-08-06 02:00:01   LastTaskResult 1
//     NikatruProjectBackup     LastRun 2026-08-06 02:30:01   LastTaskResult 1
//     assert-ops-register.mjs                                exit 0
//
// Two duty rows on a 1-day cadence, both with a run record, both with NO
// SUCCESSFUL RUN in their window — and this guard printed `ok`. It printed ok
// because the cadence limb checked that each row NAMED a `record`, a `readBy`
// and a `failingValue`. Those are three assertions about prose. The acceptance
// asks for "a query against that mechanism's own record"; no query existed.
//
// This is the same defect as the two beneath it (`expires: null` on every
// expiring row, `period` on no retention row): AN ACCEPTANCE LIMB WHOSE DOMAIN
// IS EMPTY IS GREEN OVER NOTHING. It is not a broken check — it is a check that
// silently stopped checking, which is the failure mode CLAUDE.md's verification
// discipline names first.
//
// ── WHY A SUCCESSFUL RUN, NOT A RUN ─────────────────────────────────────────
// `LastTaskResult = 1` IS a record of a run inside the window. Counting it would
// satisfy the drafted words and mean nothing: the register would assert the duty
// is performed by a mechanism that ran and failed. `cron_heartbeat` makes the
// same distinction (`ok = 0` is a fresh row and a failure), and this repo has
// already paid for conflating them — three consecutive nights of `ok = 1` on an
// HTTP 401. So a probe reports the newest SUCCESS, and a reachable record with
// no success inside the window is RED.
//
// ── THE WINDOW, AND THE RULE IT NOW ACTUALLY ENCODES ────────────────────────
//
// 🔴 THE SENTENCE THAT STOOD HERE UNTIL 2026-09-09 CONTRADICTED THE NUMBER IT
// EXPLAINED, AND THE CONTRADICTION IS ARITHMETIC RATHER THAN OPINION. It read
// "One missed run is not an alarm; two are" over a multiplier of 1.5. Put the
// last success at t=0 and the runs due at t=C, 2C, 3C:
//
//     age C   — the run due at C was missed.  ONE run missed.
//     age 2C  — the run due at 2C was missed too.  TWO runs missed.
//
// The alarm fires when `age > window`. A window of 1.5C therefore fires at age
// 1.5C, when exactly ONE run has been missed — the opposite of what the prose
// promised. For the prose to be true the window has to sit strictly between 2C
// and 3C. It never did, and nobody noticed because the two halves were never
// read against each other.
//
// ⚠️ IT IS ALSO NOT `check-heartbeats.mjs`'s RATIO ANY MORE, AND HAS NOT BEEN
// SINCE 2026-08-06. That file's citation was the other half of the stale claim:
// it ABANDONED the `1.5 x interval` staleness ceiling that morning, because a
// ratio answers "how stale is the newest row" when the question is "did the run
// that was supposed to happen, happen" — and it replaced it with an
// occurrence-anchored limb plus a fixed `MISSED_RUN_GRACE_HOURS = 2`. Citing a
// number to a file that deleted it is how a rationale outlives its reason.
//
// ── SO THE WINDOW IS DERIVED, AND THE DERIVATION IS THE RULE ────────────────
//
//     window = (missedRunsTolerated + BASE) x cadence,  BASE = 1.5
//
// BASE is the original and still-correct half-cadence margin: a window EQUAL to
// the cadence has zero margin, so a merely LATE run reads as a dead duty and the
// guard gets switched off. Adding the budget to it, rather than multiplying,
// keeps the result strictly inside `(M+1)C .. (M+2)C` for every integer M — so
// the alarm fires on exactly `M+1` missed runs, with half a cadence of slack on
// each side against clock skew and queue jitter.
//
//     missedRunsTolerated: 0  ->  1.5x  ->  a LATE run is not an alarm; a
//                                           MISSED one is.
//     missedRunsTolerated: 1  ->  2.5x  ->  one missed run is not an alarm;
//                                           two are.
//
// ⬜ THE GLOBAL DEFAULT STAYS 1.5 AND NOTHING WIDENED. The defect was the claim,
// not the number: 1.5 is exactly the M=0 window, so correcting the sentence
// costs no strictness anywhere. `_windowMultiplier` is BASE and lives in
// `_recordReaders` so it is stated once; `missedRunsTolerated` is per-row,
// capped by `_recordReaders._maxMissedRunsTolerated`, and refused without a
// `missedRunsToleratedWhy` carrying a MEASUREMENT — because a budget nobody
// measured is the waiver this whole limb exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

/** The per-row window multiplier: the register-wide BASE plus this row's own
 *  budget of tolerated missed runs. `evaluateRunRecords` has already refused a
 *  budget that is not a small non-negative integer, so a bad value can only
 *  reach here through a direct call, and it degrades to the base rather than to
 *  a wider window — the safe direction. */
export function effectiveMultiplier(row, base) {
  const b = row?.mechanism?.recordQuery?.missedRunsTolerated;
  return Number.isInteger(b) && b > 0 ? base + b : base;
}

/** The four honest outcomes of asking a mechanism whether it ran. `pass` and
 *  `fail` are the only ones that come from an answered query; `unreadable` and
 *  `unreachable` both PRINT, and they are different on purpose — the first is a
 *  missing credential or the wrong OS on this runner (fixable by wiring), the
 *  second is the register admitting no reachable record exists at all. */
export function classifyRunRecord(row, probe, nowMs, multiplier) {
  const id = row.id;
  const days = cadenceDays(row.cadence);
  const q = row?.mechanism?.recordQuery ?? {};
  if (days === null) return { verdict: 'skip', line: `${id} — not on a clock` };

  const mult = effectiveMultiplier(row, multiplier);
  const budget = mult - multiplier;
  const windowMs = days * 86_400_000 * mult;
  // The budget is NAMED in the label, not folded into the number: a row with a
  // wider window than its neighbours must say so on every line it prints, or the
  // waiver is invisible in exactly the output that is meant to expose it.
  const windowLabel =
    `${row.cadence} x ${mult} = ${(days * mult * 24).toFixed(1)}h` +
    (budget > 0 ? ` (base ${multiplier} + ${budget} missed run(s) TOLERATED on this row)` : '');

  if (q.reader === 'unreachable') {
    return { verdict: 'unreachable', line: `${id} (cadence ${row.cadence}) — NO REACHABLE RECORD: ${q.why}` };
  }
  // 🔴 A DUTY LAST SEEN FAILING DOES NOT GO GREEN BY GOING DARK. `lastObserved`
  // holds this row's own last READABLE verdict. A count of dark readers measures
  // how MANY are dark, never whether a KNOWN-BAD one is; while this row holds
  // `fail`, a reader that cannot run here is a FAILURE on it rather than a print.
  // Cleared only by a host that reads a success — see the pass branch below.
  const held = q.lastObserved?.verdict === 'fail' ? q.lastObserved : null;
  // CLAUDE.md C-6, applied with the register's OWN `ownerGated` + `ownerGap`: on a
  // runner that could not read the record, a held failure still COUNTS as FAILING
  // and still prints the word — only the block is lifted, and only here. Nothing
  // below this line is gated, so the host that CAN read the record still fails on
  // it. Gating the readable branches would be the weakening; this is not that.
  const gated = held !== null && row.ownerGated === true && nonEmpty(row.ownerGap);
  const dark = (why) =>
    held
      ? {
          verdict: 'fail',
          gated,
          line:
            `${id} — reader \`${q.reader}\` ${why} AND the register holds its last readable observation as ` +
            `FAILING (${held.at}): ${held.detail} A reader going dark does not clear a duty last seen failing.` +
            (gated ? ` OWNER-GATED, so it prints here and does not block (CLAUDE.md C-6): ${row.ownerGap}` : ''),
        }
      : { verdict: 'unreadable', line: `${id} (cadence ${row.cadence}) — reader \`${q.reader}\` ${why}` };

  if (!probe) return dark('produced no result at all on this run.');
  if (probe.unreadable) return dark(`could not run here: ${probe.why}`);
  if (probe.missing) {
    // The mechanism itself is gone. NOT "unreadable": a query ran and answered
    // that the thing the register names does not exist, which is the stale-row
    // case the header calls strictly worse than an absent one.
    return {
      verdict: 'fail',
      line:
        `${id} — the mechanism its \`recordQuery\` names DOES NOT EXIST: ${probe.why}. ` +
        'The register would go on asserting a duty performed by something that is gone.',
    };
  }
  // ⏱ 2026-09-11 (INV3). A unit read that scanned a FULL page and found no success
  // of its unit is not "no success ever": it measured the silence back to the
  // oldest run it read, and when that reaches past the window the duty is stale.
  if (Number.isFinite(probe.noSuccessSinceMs) && nowMs - probe.noSuccessSinceMs > windowMs) {
    return {
      verdict: 'fail',
      line:
        `${id} — its record IS reachable and the newest SUCCESSFUL run is older than every run it read, which reach ` +
        `back ${((nowMs - probe.noSuccessSinceMs) / 3_600_000).toFixed(1)}h — outside its own window [${windowLabel}]. ${probe.detail}`,
    };
  }
  if (typeof probe.lastSuccessMs !== 'number' || Number.isNaN(probe.lastSuccessMs)) {
    // 🔴 THE BOOTSTRAP CASE, AND IT IS THE ONE BRANCH WHERE "no success ever" IS
    // NOT A FAILURE OF THE DUTY. A row declared today for a workflow whose first
    // scheduled slot has not arrived has an EMPTY record for a reason that is not
    // the duty being broken — and every workflow row in this register has to pass
    // through that state exactly once, because the record cannot exist until the
    // file is on the default branch and the file cannot land without a row (this
    // guard holds `watched workflows === .github/workflows/*.yml` in BOTH
    // directions). Without this branch that bootstrap is a DEADLOCK whose only
    // exits are shipping a red merge queue for days or deleting the bijection —
    // the second of which is how a whole class of duty stops being watched.
    //
    // ⚠️ IT IS A GATE, NOT A PASS, AND THE DIFFERENCE IS THE POINT. The verdict
    // stays `fail`, the word FAILING stays next to the count, and the line prints
    // on every run; only the BLOCK is lifted, through the same `gated` channel
    // CLAUDE.md C-6 already uses for owner-gated rows. It is bounded four ways:
    // it applies ONLY here (a STALE success and a MISSING mechanism both still
    // block), only while `now < firstDue`, only to a date the schema limb holds
    // within one cadence window of now, and it expires by arithmetic rather than
    // by anybody remembering to remove it.
    const firstDueMs = q.firstDue ? Date.parse(q.firstDue) : NaN;
    if (!Number.isNaN(firstDueMs) && nowMs < firstDueMs) {
      return {
        verdict: 'fail',
        gated: true,
        line:
          `${id} — its record IS reachable and holds NO SUCCESSFUL RUN AT ALL, and it is NOT YET DUE: ` +
          `\`recordQuery.firstDue\` is ${q.firstDue}, ${((firstDueMs - nowMs) / 3_600_000).toFixed(1)}h from now. ` +
          `${probe.detail} [window ${windowLabel}] — the duty was declared before its first slot could arrive, ` +
          'so this prints and does not block. It BLOCKS from that moment on, whether or not anybody edits this row.',
      };
    }
    return {
      verdict: 'fail',
      line:
        `${id} — its record IS reachable and holds NO SUCCESSFUL RUN AT ALL. ${probe.detail} ` +
        `[window ${windowLabel}] — [14]O-3: a record that exists and records only failure is not a run of the duty.` +
        (q.firstDue ? ` \`recordQuery.firstDue\` (${q.firstDue}) has PASSED, so it gates nothing: delete the field.` : ''),
    };
  }
  const ageMs = nowMs - probe.lastSuccessMs;
  if (ageMs > windowMs) {
    return {
      verdict: 'fail',
      line:
        `${id} — its record IS reachable and the newest SUCCESSFUL run is ${(ageMs / 3_600_000).toFixed(1)}h old, ` +
        `outside its own window [${windowLabel}]. ${probe.detail}`,
    };
  }
  if (held) {
    return {
      verdict: 'fail',
      line:
        `${id} — its record was QUERIED and is healthy (newest success ${(ageMs / 3_600_000).toFixed(1)}h ago), but ` +
        `\`recordQuery.lastObserved\` still reads FAILING (${held.at}). Clear it HERE, on the host that can read this ` +
        'record — a held failure nobody clears reddens every runner that cannot read it.',
    };
  }
  return {
    verdict: 'pass',
    line: `${id} — queried: newest success ${(ageMs / 3_600_000).toFixed(1)}h ago, inside [${windowLabel}]. ${probe.detail}`,
  };
}

/** Pure. `probes` is `Map<rowId, probeResult>`; every impure thing has already
 *  happened. Returns `coverageLost` separately from `errors` because the two
 *  mean different things: an error is a duty that is failing, coverage lost is
 *  this limb no longer being able to tell. */
export function evaluateRunRecords(reg, probes, nowMs) {
  const errors = [];
  const prints = [];
  const decl = reg._recordReaders;
  if (!decl || typeof decl !== 'object') {
    return {
      coverageLost: [
        '`_recordReaders` is missing from the register.',
        '[14]O-3 asks for a QUERY against each mechanism\'s own record. Without the reader declarations every',
        'duty row falls out of that domain at once, and the limb goes back to checking that a row names a',
        'string — which was green while two Windows duties failed nightly.',
      ],
    };
  }
  const readerNames = new Set(Object.keys(decl).filter((k) => !k.startsWith('_')));
  const scheduled = reg.rows.filter((r) => r.kind === 'duty' && TIME_CADENCE.test(String(r.cadence ?? '')));

  if (scheduled.length === 0) {
    return {
      coverageLost: [
        'not one `duty` row carries a TIME cadence, so the [14]O-3 record-query limb ranges over the empty set.',
        'Moving every duty to `trigger`/`on-demand` must not be the way to satisfy a criterion about the records',
        'scheduled duties leave behind.',
      ],
    };
  }

  const used = new Map();
  for (const r of scheduled) {
    const q = r?.mechanism?.recordQuery;
    if (!q || !nonEmpty(q.reader)) {
      errors.push(
        `${r.id} — \`cadence: ${r.cadence}\` and no \`mechanism.recordQuery.reader\`. [14]O-3 asks for a query ` +
          'against this mechanism\'s own record; a row with no reader is outside that query and inside the count, ' +
          'which is how a duty stops being checked without the number moving.',
      );
      continue;
    }
    if (!readerNames.has(q.reader)) {
      errors.push(
        `${r.id} — \`recordQuery.reader: "${q.reader}"\` is not declared in \`_recordReaders\` ` +
          `(${[...readerNames].join(' · ')}). Free text here would let a row invent a reader nothing implements.`,
      );
      continue;
    }
    if (q.reader === 'unreachable' && !nonEmpty(q.why)) {
      errors.push(`${r.id} — \`reader: "unreachable"\` with no \`why\`. "Nothing can read it" is a state this register may record; it is not one it may pass over.`);
    }
    // 🔴 `firstDue` LIFTS A BLOCK, SO ITS SHAPE IS HELD HARDER THAN ANYTHING ELSE
    // ON THIS OBJECT. It exists for the bootstrap case in `classifyRunRecord` —
    // a duty declared before its first scheduled slot could arrive — and the one
    // way it could become a permanent waiver is a date parked in the future. So:
    // it must PARSE, it must not sit further ahead than this row's own cadence
    // window (a 7d duty can be ungated for at most 7d x 1.5, never longer), and
    // it may not coexist with a `lastObserved` that already saw a PASS, because a
    // record that has held a success is past its bootstrap by definition.
    // 🔴 REQUIRED ON EVERY RUN-HISTORY READ, ADDED 2026-09-03, AND THE POINT IS
    // THE RATCHET RATHER THAN TODAY'S VERDICT. Paired with `event: schedule`
    // this changes nothing — GitHub fires schedules only on the default branch.
    // But that makes the branch guarantee a property of GITHUB'S BEHAVIOUR, not
    // of this register, and research/76 §C's Phase 2 must eventually widen the
    // event filter to accept a Worker's dispatch. On the day it does, an implied
    // guarantee vanishes with nothing to delete and no test to fail: a run built
    // from any branch would satisfy a freshness claim about main.
    // assert-platform-proof-fresh.mjs:128 states the coupling outright — "GitHub
    // fires schedules only on the default branch, so the branch filter was never
    // what made freshness a claim about main." Requiring it HERE means the
    // widening cannot happen quietly, because the field it would have to remove
    // is one this limb refuses to be without.
    if (q.reader === 'github-run-history' && !nonEmpty(q.headBranch)) {
      errors.push(
        `${r.id} — \`recordQuery.reader: "github-run-history"\` with no \`headBranch\`. A run-history read is a ` +
          'claim about a BRANCH as well as a timer, and right now that half is true only because GitHub fires ' +
          'schedules on the default branch alone. Name the branch, so widening the event filter cannot drop the ' +
          'guarantee silently.',
      );
    }
    if (q.headBranch !== undefined && q.reader !== 'github-run-history') {
      errors.push(
        `${r.id} — \`recordQuery.headBranch\` on reader \`${q.reader}\`, which reads no run history. Nothing ` +
          'would apply it, so it would read as a guarantee this row does not actually make.',
      );
    }
    // ── Worker cron Phase 2 · the three rules that keep the split honest ─────
    // 🔴 1. THE EVENT FILTER MAY ONLY BE DROPPED ONTO A TIMER LIMB. `event` is
    // optional in the probe (it always was), so before this rule a row could
    // lose it silently and go on reporting freshness from a hand-pressed run —
    // the one-line "fix" scheduled.ts names as re-creating the 46-hour freeze.
    // Dropping it is legitimate EXACTLY when the cadence claim has moved to a
    // record only a timer can write, so that is what this demands.
    if (q.reader === 'github-run-history' && !nonEmpty(q.event) && !q.timer) {
      errors.push(
        `${r.id} — \`recordQuery\` reads run history with no \`event\` and no \`timer\` limb. Without the event ` +
          'filter this row calls a workflow fresh on ANY successful run, and a `workflow_dispatch` run is ' +
          'indistinguishable from somebody pressing a button. Either name the event, or move the cadence claim ' +
          'to a record only a timer can write (`timer: { reader: "cloudflare-d1-heartbeat", … }`).',
      );
    }
    // 🔴 2. AND IT MAY NEVER BE WIDENED IN PLACE. Naming `workflow_dispatch` here
    // is the same weakening wearing the other hat: it would satisfy rule 1 while
    // making a hand-press the evidence.
    if (q.event !== undefined && String(q.event).includes('workflow_dispatch')) {
      errors.push(
        `${r.id} — \`recordQuery.event: ${JSON.stringify(q.event)}\`. A dispatched run proves somebody, or ` +
          'something, pressed a button; it is not a cadence claim. The timer\'s own record is `timer`.',
      );
    }
    // 🔴 3. A TIMER LIMB IS A SECOND RECORD, SO ITS SHAPE IS CHECKED, NOT TRUSTED.
    // An unnarrowed one would let ANY healthy job in cron_heartbeat vouch for this
    // workflow — the retention sweep standing in for a dispatcher that has not
    // fired in a week — which is precisely the fusion this split exists to undo.
    if (q.timer !== undefined) {
      const t = q.timer;
      if (q.reader !== 'github-run-history') {
        errors.push(`${r.id} — \`recordQuery.timer\` on reader \`${q.reader}\`. The split exists to separate a run OUTCOME from a cadence claim; a row that reads no run history has nothing to split.`);
      } else if (!t || typeof t !== 'object' || t.reader !== 'cloudflare-d1-heartbeat') {
        errors.push(`${r.id} — \`recordQuery.timer.reader\` must be \`"cloudflare-d1-heartbeat"\`; it is the only record in this portfolio a human hand cannot write.`);
      } else if (!nonEmpty(t.table) || !nonEmpty(t.wrangler)) {
        errors.push(`${r.id} — \`recordQuery.timer\` needs both \`table\` and \`wrangler\`; without them the heartbeat database cannot be resolved and the limb would go permanently unreadable.`);
      } else if (!nonEmpty(t.job) && !nonEmpty(t.target)) {
        errors.push(
          `${r.id} — \`recordQuery.timer\` narrows by neither \`job\` nor \`target\`, so it would read the STALEST ` +
            'row of the whole table. Any healthy unrelated job would then vouch for this workflow\'s timer.',
        );
      }
      used.set(t.reader, (used.get(t.reader) ?? 0) + 1);
    }
    // 🔴 THE PER-ROW MISS BUDGET, AND EVERY CONDITION THAT KEEPS IT FROM BECOMING
    // A WAIVER. It widens THIS row's alarm window and nothing else's, which is
    // the point — one global ratio cannot serve an hourly laptop routine that
    // only fires while the desktop app is open AND a 7d workflow duty, and the
    // way that tension has historically been resolved is by widening the GLOBAL
    // number, which silences every duty at once. So: it is a small non-negative
    // integer, capped by a declared ceiling, refused on a row nothing queries,
    // and refused without a `why` that carries a MEASUREMENT a later reader can
    // check. "This row misses sometimes" is an adjective; "worst observed gap
    // 4.98h across 66 gaps" is evidence, and only the second may buy slack.
    if (q.missedRunsTolerated !== undefined) {
      const b = q.missedRunsTolerated;
      const budgetCap = decl._maxMissedRunsTolerated;
      if (!Number.isInteger(b) || b < 0) {
        errors.push(
          `${r.id} — \`recordQuery.missedRunsTolerated: ${JSON.stringify(b)}\` must be a non-negative INTEGER. ` +
            'It counts missed runs; a fraction of a missed run is not a thing the window can mean.',
        );
      } else if (!Number.isInteger(budgetCap) || budgetCap < 0) {
        errors.push(
          `${r.id} — \`recordQuery.missedRunsTolerated\` is set and \`_recordReaders._maxMissedRunsTolerated\` is ` +
            'missing or not a non-negative integer. An UNDECLARED ceiling reads as NO ceiling, and this is the one ' +
            'field on the object that widens an alarm.',
        );
      } else if (b > budgetCap) {
        errors.push(
          `${r.id} — \`recordQuery.missedRunsTolerated: ${b}\` is above the declared ceiling of ${budgetCap}. ` +
            'This number RATCHETS DOWN as duties move off substrates that cannot keep their own schedule; ' +
            'raising the ceiling to fit a row is how every window gets widened one row at a time.',
        );
      } else if (q.reader === 'unreachable') {
        errors.push(`${r.id} — \`recordQuery.missedRunsTolerated\` on a row whose reader is \`unreachable\`. No query is made, so no window applies and nothing could be tolerated.`);
      } else if (b > 0 && (!nonEmpty(q.missedRunsToleratedWhy) || !DURABLE_ID.test(q.missedRunsToleratedWhy))) {
        errors.push(
          `${r.id} — \`recordQuery.missedRunsTolerated: ${b}\` with no \`missedRunsToleratedWhy\` carrying a ` +
            'MEASUREMENT (a count, a gap, a date a later reader can re-take). A budget stated as a judgement is a ' +
            'waiver; a budget stated as an observation is a window somebody can re-derive and shrink.',
        );
      }
    }
    if (q.missedRunsToleratedWhy !== undefined && !Number.isInteger(q.missedRunsTolerated)) {
      errors.push(`${r.id} — \`recordQuery.missedRunsToleratedWhy\` with no \`missedRunsTolerated\`. A justification for a budget that does not exist reads as slack this row does not actually have.`);
    }
    if (q.firstDue !== undefined) {
      const dueMs = typeof q.firstDue === 'string' ? Date.parse(q.firstDue) : NaN;
      const days = cadenceDays(r.cadence);
      // The bootstrap wait is bounded by THIS row's own window, budget included —
      // the same number `classifyRunRecord` will measure it against. Using the
      // bare base here would let a budgeted row wait longer than it may.
      const mult = effectiveMultiplier(r, decl._windowMultiplier);
      if (Number.isNaN(dueMs)) {
        errors.push(
          `${r.id} — \`recordQuery.firstDue: ${JSON.stringify(q.firstDue)}\` is not a parseable instant. This field ` +
            'lifts a block, so it is a timestamp a machine expires or it is nothing.',
        );
      } else if (q.reader === 'unreachable') {
        errors.push(`${r.id} — \`recordQuery.firstDue\` on a row whose reader is \`unreachable\`. Nothing queries this record, so no query can be waiting for it.`);
      } else if (q.lastObserved?.verdict === 'pass') {
        errors.push(
          `${r.id} — \`recordQuery.firstDue\` alongside \`lastObserved: { verdict: "pass" }\`. A record that has ` +
            'already held a success is past its bootstrap; the field would then be a waiver rather than a wait.',
        );
      } else if (days !== null && Number.isFinite(mult) && dueMs - Date.now() > days * 86_400_000 * mult) {
        errors.push(
          `${r.id} — \`recordQuery.firstDue: ${q.firstDue}\` is more than one cadence window ` +
            `(${r.cadence} x ${mult}) into the future. THAT IS THE ONLY WAY THIS FIELD BECOMES A PERMANENT ` +
            'WAIVER, and it is refused here: a duty may wait for its first slot, never for an arbitrary date.',
        );
      }
    }
    // The held observation is the only thing standing between a known-bad duty
    // and a green runner that cannot read it, so its shape is checked, not trusted.
    if (q.lastObserved !== undefined) {
      const o = q.lastObserved;
      if (q.reader === 'unreachable') {
        errors.push(`${r.id} — \`recordQuery.lastObserved\` on a row whose reader is \`unreachable\`. Nothing has ever read this record, so there is no observation to hold.`);
      } else if (!o || typeof o !== 'object' || (o.verdict !== 'pass' && o.verdict !== 'fail') || !nonEmpty(o.at) || !nonEmpty(o.detail) || !DURABLE_ID.test(o.detail)) {
        errors.push(
          `${r.id} — \`recordQuery.lastObserved\` must be \`{ verdict: "pass" | "fail", at, detail }\` whose detail ` +
            'carries something a later reader can look up (a result code, a timestamp, a run id). An observation ' +
            'stated as an adjective holds nothing, and this field is what a dark reader is measured against.',
        );
      }
    }
    used.set(q.reader, (used.get(q.reader) ?? 0) + 1);
  }

  // ── the ceiling on the escape hatch, and the floor under the readers ──────
  const unreachable = used.get('unreachable') ?? 0;
  const cap = decl._maxUnreachable;
  if (!Number.isInteger(cap) || cap < 0) {
    errors.push('`_recordReaders._maxUnreachable` must be a non-negative integer — it is the ceiling that stops `unreachable` becoming the whole domain.');
  } else if (unreachable > cap) {
    errors.push(
      `${unreachable} duty row(s) declare \`reader: "unreachable"\` and the ceiling is ${cap}. ` +
        'This number RATCHETS DOWN as records become reachable; it never rises. Raising it is how a limb ' +
        'that queries nothing goes back to reporting ok over an empty domain.',
    );
  }
  if (unreachable === scheduled.length) {
    return {
      coverageLost: [
        `all ${scheduled.length} scheduled duty row(s) declare \`reader: "unreachable"\`.`,
        'Every outcome would then be a print, this limb could not fail, and [14]O-3 would be satisfied by a',
        'register that queries nothing at all — which is the exact state it was written to end.',
      ],
    };
  }

  // 🔴 THE SAME CEILING FOR THE OTHER ESCAPE HATCH. `unreadable` is "could not
  // tell", and until now it had NO declared limit — so a runner that could read
  // nothing printed and exited 0, which is the state the header at the top of
  // the probe recounts. An UNDECLARED ceiling reads as NO ceiling, so a missing
  // key refuses here rather than defaulting to a number this file chose.
  const readCap = decl._maxUnreadable;
  if (!Number.isInteger(readCap) || readCap < 0) {
    return {
      coverageLost: [
        '`_recordReaders._maxUnreadable` is missing, or is not a non-negative integer.',
        'It is the ceiling on how many scheduled duties this limb may fail to READ on one runner. With no',
        'ceiling declared every row can go unreadable and still only print — the exact shape [14]O-3 replaced.',
      ],
    };
  }
  // 🔴 THE CEILING IS DERIVED, SO DERIVE IT — IT WENT STALE THE DAY AFTER IT WAS
  // WRITTEN. `_maxUnreadableWhy` states the arithmetic in prose: "headroom for
  // ONE network provider going dark, plus one spare", counted as "6 on the
  // GitHub API, 1 on Cloudflare D1, 1 on GlitchTip … both at once costs 2, and
  // 3 still absorbs it". Adding the e2e timer limb on 2026-09-04 made Cloudflare
  // TWO rows, so both-dark became 3 — the ceiling exactly, with zero headroom —
  // and not one character of the prose moved. A hand-maintained derived number
  // is a number that silently stops being derived.
  // 🔴 AND THE TWO DIRECTIONS ARE NOT THE SAME MISTAKE, which the first version
  // of this check got wrong by demanding equality. A ceiling ABOVE the
  // derivation is a WEAKENING — it tolerates more darkness than the stated rule
  // buys, which is how `unreadable` becomes the escape hatch [14]O-3 replaced,
  // so it FAILS. A ceiling BELOW it is STRICTER: nothing is let through, the
  // register simply no longer keeps the headroom it promises, and a provider
  // outage will redden CI on a measurement problem rather than a duty failure.
  // That is worth SAYING and not worth blocking — and `_maxUnreadable: 0`, which
  // this register's own tests call legal, is exactly that case.
  const derived = deriveUnreadableCeiling(reg);
  const arithmetic =
    `derivation: max(rows behind any single NON-GitHub provider) + 1 spare = ${derived.ceiling} ` +
    `[${derived.perProvider.map(([p, n]) => `${p}=${n}`).join(', ') || 'no non-GitHub providers'}]. ` +
    'A row with a `timer` limb counts against BOTH its providers, because either going dark makes the ' +
    'combined probe unreadable. GitHub is excluded on purpose: its rows are MEANT to break the ceiling ' +
    'together, since that is what a lost GITHUB_TOKEN looks like.';
  if (readCap > derived.ceiling) {
    errors.push(
      `\`_recordReaders._maxUnreadable\` is ${readCap}, ABOVE the register's own derivation of ${derived.ceiling}. ` +
        `That tolerates more darkness than the rule it claims to follow buys. ${arithmetic}`,
    );
  } else if (readCap < derived.ceiling) {
    prints.push(
      `[14]O-3 — \`_maxUnreadable\` is ${readCap} but the derivation now gives ${derived.ceiling}, so the ` +
        '"one provider dark, plus one spare" headroom this key promises NO LONGER HOLDS: a single provider ' +
        `outage can redden CI on a measurement problem. ${arithmetic}`,
    );
  }
  for (const name of readerNames) {
    if (!used.has(name)) {
      errors.push(
        `\`_recordReaders.${name}\` is declared and no row uses it. A reader with no member is code that ` +
          'cannot fail, and it inflates the apparent size of the domain — delete it, or point a row at it.',
      );
    }
  }

  // ── the queries themselves ────────────────────────────────────────────────
  const multiplier = typeof decl._windowMultiplier === 'number' && decl._windowMultiplier >= 1 ? decl._windowMultiplier : null;
  if (multiplier === null) {
    errors.push('`_recordReaders._windowMultiplier` must be a number >= 1. A window shorter than the cadence reports a healthy duty dead.');
    return { errors, prints };
  }
  // ⏱ 2026-09-11 — THE LIVE READS WERE NOT MADE ON THIS HOST (`liveReadPlan`).
  // Everything above is the register's own shape and has already decided;
  // everything below classifies an ANSWER, and there is none to classify. No
  // tally is printed, because a tally of zero reads is the line a reader mistakes
  // for "zero failing", and `main()` prints why nothing was read instead.
  if (probes === LIVE_READS_NOT_MADE) {
    return { errors, prints, live: [], measurement: [], stats: { scheduled: scheduled.length, notRead: true } };
  }

  const tally = { pass: 0, fail: 0, unreadable: 0, unreachable: 0 };
  // ⏱ 2026-09-11 — every blocking verdict read off a record is also handed back in
  // `live`, so ONE router decides whether this host carries it (INV1/INV2/INV4),
  // and the unreadable ceiling is handed back in `measurement`, because a runner
  // that read too little is COVERAGE LOST, not a failing duty (INV6).
  const live = [];
  const measurement = [];
  const unreachableLines = [];
  const unreadableLines = [];
  // 🔴 THE GATED LINES ARE STILL IN `tally.fail`. A gate that moved them to their
  // own counter would put the word FAILING next to a smaller number every time a
  // row was gated — the count, not the exit code, is what a reader scans.
  const gatedFailLines = [];
  for (const r of scheduled) {
    if (!r?.mechanism?.recordQuery?.reader || !readerNames.has(r.mechanism.recordQuery.reader)) continue;
    const c = classifyRunRecord(r, probes.get(r.id), nowMs, multiplier);
    tally[c.verdict] = (tally[c.verdict] ?? 0) + 1;
    if (c.verdict === 'fail') {
      (c.gated ? gatedFailLines : errors).push(c.line);
      if (!c.gated) live.push({ id: r.id, line: c.line, code: 1, limb: '[14]O-3' });
    } else if (c.verdict === 'unreachable') unreachableLines.push(c.line);
    else if (c.verdict === 'unreadable') unreadableLines.push(c.line);
    else if (c.verdict === 'pass') prints.push(`[14]O-3 — ${c.line}`);
  }

  if (tally.unreadable > readCap) {
    const over =
      `${tally.unreadable} scheduled duty(ies) went UNREADABLE on this runner and the ceiling is ${readCap}. ` +
      'Unreadable is "could not tell", never "it is fine" — above this line the limb has read too little of ' +
      'its own domain to be believed about the rest. Ratchets DOWN as credentials and platforms arrive. ' +
      'That is COVERAGE LOST, exit 2 (INV6).';
    errors.push(over);
    measurement.push(over);
  }

  // 🔴 THE NUMBER THAT MUST NEVER BE INVISIBLE. `0 queried` and `4 queried` read
  // identically in a wall of prints unless the count is stated, and "queried 0
  // records" is precisely the state that was green for a day and a half.
  // ⚠️ EVERY COUNT CARRIES ITS OWN LABEL IMMEDIATELY BEFORE IT, AND THE CEILINGS
  // ARE BOUND TO THEIR OWN NUMBER RATHER THAN TRAILING THE CLAUSE. On 2026-09-09
  // two separate reading passes filed a defect that did not exist — "22
  // unreadable duties against a ceiling of 12" — off the previous shape of this
  // line, in which `22 record(s) QUERIED` and `(ceiling 12)` sat in the same
  // sentence with `0 reader(s) unreadable` between them. The measured run said
  // 22 QUERIED, 0 unreadable. A summary line that can be misread into an alarm
  // costs exactly what a false alarm costs, so the format is part of the guard.
  prints.push(
    `[14]O-3 — scheduled=${scheduled.length} · queried_ok=${tally.pass} · failing=${tally.fail} ` +
      `(owner-gated=${gatedFailLines.length}: printed, not blocking) · ` +
      `unreadable=${tally.unreadable}/ceiling ${readCap} · unreachable=${tally.unreachable}/ceiling ${cap} ` +
      `— [queried_ok is duties whose record WAS read and is inside its window; unreadable is duties this ` +
      `runner could not read at all. They are different numbers and only the second has the ceiling ${readCap}.]`,
  );
  if (tally.pass === 0 && tally.fail === 0) {
    prints.push(
      '[14]O-3 — 🔴 THE RECORD-QUERY LIMB ANSWERED ZERO QUERIES ON THIS RUN. Every scheduled duty is either ' +
        'unreachable by declaration or unreadable for want of a credential/platform here, so nothing above ' +
        'could have failed. This line exists so that state can never be mistaken for a clean result.',
    );
  }
  for (const l of gatedFailLines) prints.push(`[14]O-3 — 🔴 KNOWN FAILING, NOT BLOCKING HERE: ${l}`);
  for (const l of unreadableLines) prints.push(`[14]O-3 — ${l}`);
  for (const l of unreachableLines) prints.push(`[14]O-3 — ${l}`);

  return { errors, prints, live, measurement, stats: { scheduled: scheduled.length, ...tally, gatedFail: gatedFailLines.length } };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PURE HALF. Everything that can go wrong in the register itself is decided
// here, so the failing cases are exercisable without a repo on disk.
// ─────────────────────────────────────────────────────────────────────────────
export function evaluate(reg, tree, nowMs) {
  const errors = [];
  const prints = [];
  const bad = (m) => errors.push(m);

  if (!reg || typeof reg !== 'object') return { errors: ['register is not an object'], prints };
  for (const key of ['_kinds', '_providers', '_maxCadenceDays', '_requiredCoverage', 'rows']) {
    if (!(key in reg)) return { errors: [`register has no \`${key}\``], prints };
  }
  const kinds = new Set(reg._kinds);
  const providers = new Set(reg._providers);
  const rows = reg.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { errors: ['register `rows` is not a non-empty array — a register of nothing is what eighteen acceptance criteria were already quantifying over'], prints };
  }

  const byId = new Map();
  for (const r of rows) {
    if (!nonEmpty(r?.id)) { bad('a row has no `id`'); continue; }
    if (byId.has(r.id)) bad(`duplicate row id \`${r.id}\` — two rows claiming the same duty means one of them is never read`);
    byId.set(r.id, r);
  }

  let onDemand = 0;
  let unverified = 0;
  let cannotRevert = 0;
  let unverifiableAnchors = 0;
  // Counted so ZERO armed tripwires cannot look like a clean register. If this
  // reaches 0 the `degradedUntil` limb ranges over the empty set, and an empty
  // domain that prints nothing is the defect this whole file is written against.
  let datedTripwires = 0;
  const gaps = [];
  // 🔴 The three counters below exist for one reason: an acceptance limb whose
  // domain is empty prints exactly like one that checked everything. [14]O-11's
  // lead-window arithmetic had executed ZERO times over twelve rows and [14]O-17's
  // deleting-job limb over nineteen; both reported clean. Counting the EXECUTIONS
  // rather than the rows is the difference between "twelve expiries checked" and
  // "twelve rows, none checked".
  let expiringRows = 0;
  let expiryWindowChecks = 0;
  const nullExpiries = [];
  // ⏱ 2026-09-24 · every date the arithmetic below graded, printed one per line
  // (O-APPLE-SIGNING-EXPIRY-UNWATCHED): a count names no row and no date.
  const datedExpiries = [];
  let retentionRows = 0;
  let periodDeclared = 0;
  /** Rows whose period is enforced by the STORE (a KV TTL) rather than by a
   *  sweeping job. Counted separately from `periodDeclared` because they need no
   *  `deletingJob` — and printed, so "0 declare a PERIOD" can never again read as
   *  "nothing in this portfolio expires", which stopped being true on 2026-08-09. */
  let ttlEnforced = 0;
  const periodUndeclared = [];

  for (const r of rows) {
    const id = r.id ?? '<no id>';
    if (!kinds.has(r.kind)) {
      bad(`${id} — kind \`${r.kind}\` is not one of ${[...kinds].join(' · ')}. Free text here would let a row opt out of every per-kind rule by inventing a ninth kind nothing checks.`);
      continue;
    }
    for (const f of ['what', 'detector', 'response']) {
      if (!nonEmpty(r[f])) bad(`${id} — \`${f}\` is empty. A failure with no named ${f} is the thing this register exists to make impossible.`);
    }

    // ── cadence ──────────────────────────────────────────────────────────────
    const days = cadenceDays(r.cadence);
    if (r.cadence === 'on-demand') {
      onDemand++;
      if (!nonEmpty(r.why)) bad(`${id} — \`cadence: on-demand\` with no \`why\`. This one word disabled the staleness limb per row in the drafted acceptance, so it is not free.`);
    } else if (r.cadence === 'trigger') {
      if (!nonEmpty(r.trigger)) bad(`${id} — \`cadence: trigger\` with no named \`trigger\` event.`);
    } else if (days === null) {
      bad(`${id} — \`cadence\` must be a duration like \`8h\`/\`120d\`, or \`on-demand\` with a \`why\`, or \`trigger\` with a named event. Got: ${JSON.stringify(r.cadence)}`);
    } else {
      const max = reg._maxCadenceDays?.[r.kind];
      if (typeof max !== 'number') bad(`${id} — no \`_maxCadenceDays\` entry for kind \`${r.kind}\`, so its cadence is unbounded.`);
      else if (days > max) bad(`${id} — cadence ${r.cadence} (${days}d) exceeds the stage maximum for \`${r.kind}\` (${max}d). A row cannot declare its own shelf life.`);
    }

    // ── mechanism ────────────────────────────────────────────────────────────
    const mech = r.mechanism;
    if (!mech || typeof mech !== 'object') {
      bad(`${id} — no \`mechanism\`. A duty with no named substrate is a duty performed by somebody remembering.`);
    } else {
      for (const f of ['substrate', 'anchor', 'record', 'failingValue', 'readBy']) {
        if (!nonEmpty(mech[f])) bad(`${id} — \`mechanism.${f}\` is empty.`);
      }
      if (nonEmpty(mech.anchor)) {
        if (OUTSIDE_CI.some((p) => mech.anchor.startsWith(p))) {
          unverifiableAnchors++;
        } else if (!tree.paths.has(mech.anchor)) {
          bad(`${id} — \`mechanism.anchor\` names \`${mech.anchor}\`, which is not in the tree. A mechanism that names a substrate that does not exist is a mechanism that does not exist.`);
        }
      }
    }

    // ── EVERY NAMED READER MUST EXIST. ───────────────────────────────────────
    // `.anchor` was the only path this guard checked, and `.readBy` is the field
    // that carries the claim that actually matters: WHO LOOKS. The first draft
    // of this register named `tooling/ci/assert-update-coverage.mjs` as the
    // reader for the dependency duty, and that file has never existed — the row
    // asserted a live reader for a duty nothing reads, which is the precise
    // shape ("zero readers") the whole stage was written about, reproduced
    // inside the register meant to end it. Prose is checked here rather than
    // trusted because a named file is not prose: it either exists or it does not.
    for (const f of ['detector', 'response', 'mechanism.record', 'mechanism.readBy', 'mechanism.failingValue']) {
      const v = f.startsWith('mechanism.') ? r.mechanism?.[f.slice(10)] : r[f];
      if (typeof v !== 'string') continue;
      for (const p of v.match(NAMED_PATH) ?? []) {
        if (!tree.paths.has(p)) {
          bad(
            `${id} — \`${f}\` names \`${p}\`, which is not in the tree. A row that names a reader, a record or a detector that does not exist ` +
              'is the register asserting coverage it does not have — the "zero readers" defect, wearing the clothes of the file that was supposed to end it.',
          );
        }
      }
    }

    // ── access providers, from a fixed vocabulary ────────────────────────────
    const ap = r.accessProviders;
    if (!Array.isArray(ap) || ap.length === 0) {
      bad(`${id} — \`accessProviders\` is empty. A row whose access path resolves to NO provider cannot be checked against any failure, so it must fail rather than pass. This is what makes O-14 falsifiable.`);
    } else {
      for (const p of ap) {
        if (!providers.has(p)) bad(`${id} — access provider \`${p}\` is not in the fixed vocabulary (${[...providers].join(' · ')}). Free text here makes the intersection uncomputable.`);
      }
    }

    // ── source ───────────────────────────────────────────────────────────────
    if (r.source === 'unverified') {
      unverified++;
      if (!nonEmpty(r.unverifiedWhy)) bad(`${id} — \`source: unverified\` with no \`unverifiedWhy\`. An unverified number nobody labels becomes a fact by repetition.`);
    } else if (r.source !== 'verified') {
      bad(`${id} — \`source\` must be \`verified\` or \`unverified\`, got ${JSON.stringify(r.source)}.`);
    }

    // ── owner-gated / degraded ───────────────────────────────────────────────
    if (r.ownerGated === true) {
      if (!nonEmpty(r.ownerGap)) bad(`${id} — \`ownerGated: true\` with no \`ownerGap\`. A gap nobody describes is a waiver.`);
      else gaps.push(`${id} — ${r.ownerGap}`);
    }
    if ('degradedUntil' in r) {
      datedTripwires++;
      if (!isIsoDate(r.degradedUntil)) bad(`${id} — \`degradedUntil\` must be an ISO date (YYYY-MM-DD).`);
      else if (!nonEmpty(r.degradedWhy)) bad(`${id} — \`degradedUntil\` with no \`degradedWhy\`. A deadline with no reason attached is a deadline somebody extends.`);
      else if (!(Number.isInteger(r.degradedLeadDays) && r.degradedLeadDays > 0)) {
        bad(
          `${id} — \`degradedUntil\` with no positive integer \`degradedLeadDays\`. A dated tripwire with no lead ` +
            'window goes from one quiet print straight to a failure that reddens every branch on the day, with ' +
            'nothing in between — so the first time anyone reads it is the morning it blocks work unrelated to it. ' +
            'Declare how many days of warning the remaining work needs; only the row\'s author knows that number, ' +
            'which is why this guard demands one rather than inventing one.',
        );
      } else {
        const daysLeft = (Date.parse(`${r.degradedUntil}T00:00:00Z`) - nowMs) / 86_400_000;
        if (daysLeft <= 0) {
          bad(
            `${id} — the dated tripwire \`degradedUntil: ${r.degradedUntil}\` has PASSED and the gap is still open. ` +
              `It went red ${r.degradedLeadDays} day(s) before this, so nothing about today is a surprise. ` +
              `THE GAP: ${r.degradedWhy} THE RESPONSE ON RECORD: ${r.response ?? '<none>'} — do that, or, if the gap ` +
              'turns out to be owner-only work, convert the row to `ownerGated` with a written `ownerGap` so it ' +
              'prints forever instead of blocking. Moving the date is the one move this field exists to refuse.',
          );
        } else if (daysLeft <= r.degradedLeadDays) {
          bad(
            `${id} — the dated tripwire \`degradedUntil: ${r.degradedUntil}\` FIRES IN ${Math.ceil(daysLeft)} DAY(S), ` +
              `inside its own ${r.degradedLeadDays}-day lead window, and the gap is still open. This is the warning, ` +
              'on purpose and with time left to act: on the date itself it becomes a failure that blocks every ' +
              `branch. THE GAP: ${r.degradedWhy} THE RESPONSE ON RECORD: ${r.response ?? '<none>'}`,
          );
        } else {
          prints.push(
            `${id} — DEGRADED. Goes RED in ${Math.ceil(daysLeft - r.degradedLeadDays)} day(s) ` +
              `(${r.degradedLeadDays}-day lead window), hard failure on ${r.degradedUntil}: ${r.degradedWhy}`,
          );
        }
      }
    }

    // ── the date XOR: a human date, or a machine record. Never neither. ──────
    const dateField = HUMAN_DATED.get(r.kind);
    if (dateField && r.cadence !== 'trigger') {
      if (!(dateField in r)) {
        bad(`${id} — kind \`${r.kind}\` must carry \`${dateField}\` (a date, or null with an ownerGap / degradedUntil saying why not). Omitting the key is how a claim about the past becomes true forever.`);
      } else if (r[dateField] === null) {
        if (r.ownerGated !== true && !('degradedUntil' in r)) {
          bad(`${id} — \`${dateField}\` is null with neither \`ownerGated\` + \`ownerGap\` nor a dated \`degradedUntil\`. "Never done" must cost something.`);
        }
      } else if (!isIsoDate(r[dateField])) {
        bad(`${id} — \`${dateField}\` is not an ISO date: ${JSON.stringify(r[dateField])}`);
      } else {
        const t = Date.parse(`${r[dateField]}T00:00:00Z`);
        if (t > nowMs) bad(`${id} — \`${dateField}\` is in the FUTURE (${r[dateField]}). A drill that has not happened cannot be dated.`);
        else if (days !== null) {
          const age = (nowMs - t) / 86_400_000;
          if (age > days) {
            bad(`${id} — \`${dateField}\` is ${age.toFixed(0)} days old and the declared cadence is ${r.cadence} (${days}d). This is the whole of O-13: the same fact expires.`);
          }
        }
      }
    }

    // ── O-8: cannot-revert requires a mitigation that is itself a row ────────
    if (r.kind === 'revert' && r.path === 'cannot-revert') {
      cannotRevert++;
      const m = byId.get(r.mitigation);
      if (!nonEmpty(r.mitigation)) {
        bad(`${id} — \`path: cannot-revert\` with no named \`mitigation\`. Unbounded cannot-revert is how marking every surface unrevertable made the drafted criterion green.`);
      } else if (!m) {
        bad(`${id} — \`mitigation\` names \`${r.mitigation}\`, which is not a row in this register. A mitigation that is not a checkable row is a sentence.`);
      } else if (m.kind !== 'revert') {
        bad(`${id} — \`mitigation\` \`${r.mitigation}\` is kind \`${m.kind}\`, not \`revert\`.`);
      } else if (cadenceDays(m.cadence) === null && m.cadence !== 'trigger') {
        bad(`${id} — the mitigation \`${r.mitigation}\` has no cadence of its own (${JSON.stringify(m.cadence)}), so it can never go stale. That is what turns "we have a kill switch" back into an assertion.`);
      }
    }

    // ── O-14: the intersection, over two independently written lists ────────
    if (r.kind === 'failure-mode') {
      const td = r.takesDown;
      if (!Array.isArray(td) || td.length === 0) {
        bad(`${id} — a \`failure-mode\` row must name the providers it \`takesDown\`.`);
      } else {
        for (const p of td) if (!providers.has(p)) bad(`${id} — \`takesDown\` value \`${p}\` is not in the fixed vocabulary.`);
      }
      const via = byId.get(r.respondsVia);
      if (!nonEmpty(r.respondsVia)) {
        bad(`${id} — no \`respondsVia\`. A failure with no named response is the thing O-14 exists to catch.`);
      } else if (!via) {
        bad(`${id} — \`respondsVia\` names \`${r.respondsVia}\`, which is not a row in this register.`);
      } else if (via.kind !== 'recovery-path') {
        bad(`${id} — \`respondsVia\` \`${r.respondsVia}\` is kind \`${via.kind}\`, not \`recovery-path\`.`);
      } else if (Array.isArray(td) && Array.isArray(via.accessProviders)) {
        const clash = td.filter((p) => via.accessProviders.includes(p));
        if (clash.length) {
          bad(
            `${id} — THE RESPONSE PATH DEPENDS ON THE THING THAT IS DOWN. \`${r.respondsVia}\` needs [${via.accessProviders.join(', ')}] and this failure takes down [${td.join(', ')}]; they share: ${clash.join(', ')}. ` +
              'The two lists are written in two different rows on purpose — that is the only reason this can fail at all.',
          );
        }
      }
    }

    // ── expiring ─────────────────────────────────────────────────────────────
    if (r.kind === 'expiring') {
      expiringRows++;
      if (!(Number.isInteger(r.leadDays) && r.leadDays > 0)) {
        bad(`${id} — \`leadDays\` must be a positive integer: the lead time is what makes an expiry ACTIONABLE rather than merely recorded.`);
      }
      // 🔴 [14]O-11's repair, 2026-08-06. Every one of the twelve rows carried
      // `expires: null` and the guard tolerated it, so the arithmetic below had
      // NEVER RUN — twelve rows of apparent coverage over zero checked dates.
      // The dates are genuinely not knowable here (vendor consoles, the Oracle
      // box, and — since [ADR 054], 2026-08-14 — the sibling brain repo
      // `nikatru/business/`, which was gitignored `company/business/` when this
      // repair was written), so the tolerance stays; what it now costs is
      // this field. "Nobody knows" becomes "nobody has read it FROM HERE", which
      // is a sentence somebody can act on — and deleting the field reddens.
      if (!nonEmpty(r.expiryKnownAt)) {
        bad(
          `${id} — an \`expiring\` row must carry \`expiryKnownAt\`: the exact place the date is READ FROM. ` +
            'A null expiry is tolerated in this register precisely because the date lives somewhere this repo ' +
            'cannot reach — so naming that somewhere is the whole of what makes the tolerance honest.',
        );
      }
      if (!('expires' in r)) {
        bad(`${id} — an \`expiring\` row must carry \`expires\` (a date, or null with an ownerGap).`);
      } else if (r.expires === null) {
        nullExpiries.push(`${id} — expiry UNREAD. Read it at: ${r.expiryKnownAt ?? '<no expiryKnownAt>'}`);
        // Two honest reasons for a null expiry, and only two. Either nobody has
        // read the date yet (a gap somebody owns), or there IS no fixed date
        // because another duty resets the clock — a non-use window rather than a
        // calendar expiry. The second still has to name that duty, so "satisfied
        // by construction" stays a checkable claim rather than a reassurance.
        if (r.ownerGated !== true && !nonEmpty(r.satisfiedBy)) {
          bad(`${id} — \`expires: null\` with neither \`ownerGated\` + \`ownerGap\` nor a \`satisfiedBy\` row that resets the clock. An unknown expiry is a gap, not an absence.`);
        }
      } else if (!isIsoDate(r.expires)) {
        bad(`${id} — \`expires\` is not an ISO date: ${JSON.stringify(r.expires)}`);
      } else {
        // The arithmetic. Counted, because the count is the only thing that
        // distinguishes "twelve expiries checked" from "twelve rows, none checked".
        expiryWindowChecks++;
        const t = Date.parse(`${r.expires}T00:00:00Z`);
        const daysLeft = (t - nowMs) / 86_400_000;
        datedExpiries.push({ id, expires: r.expires, daysLeft, leadDays: r.leadDays });
        if (daysLeft < 0) bad(`${id} — \`expires: ${r.expires}\` is in the PAST.`);
        else if (daysLeft <= r.leadDays) bad(`${id} — \`expires: ${r.expires}\` is ${daysLeft.toFixed(0)} day(s) away, inside its own ${r.leadDays}-day lead window. Renew it.`);
      }
      if ('satisfiedBy' in r) {
        const s = byId.get(r.satisfiedBy);
        if (!s) bad(`${id} — \`satisfiedBy\` names \`${r.satisfiedBy}\`, which is not a row in this register.`);
        else if (!(Number.isInteger(r.windowDays) && r.windowDays > 0)) {
          bad(`${id} — \`satisfiedBy\` without a \`windowDays\`: "satisfied by construction" is only checkable against the window it is inside.`);
        } else {
          const sd = cadenceDays(s.cadence);
          // A MARGIN, not merely "inside the window". A non-use clock has to
          // survive SEVERAL missed cycles, not exactly one — a duty running at
          // 179d inside a 180d window is satisfied-by-construction on paper and
          // one late run from being armed. The divisor is a JUDGEMENT CALL and
          // is recorded as one: eight missed cycles. It is reachable today —
          // lengthening the backup duty from 8h to the duty maximum of 31d trips
          // it against the 180d window, which is the mutation that proved it.
          const margin = r.windowDays / 8;
          if (sd === null) bad(`${id} — the satisfying row \`${r.satisfiedBy}\` has no duration cadence, so it cannot be shown to keep this inside its window.`);
          else if (sd > margin) {
            bad(
              `${id} — \`${r.satisfiedBy}\` runs every ${sd}d, and a ${r.windowDays}d non-use window needs a cadence at or under ${margin}d to survive several missed cycles. ` +
                'It no longer satisfies this by construction. This is exactly the silent RE-ARMING the row was written to catch: what makes the clock safe is the DUTY, not the token.',
            );
          }
        }
      }
    }

    // ── review ───────────────────────────────────────────────────────────────
    if (r.kind === 'review') {
      if (!Number.isInteger(r.dayCount) || r.dayCount <= 0) bad(`${id} — \`dayCount\` must be a positive integer.`);
      if (!r.outcomes || typeof r.outcomes !== 'object' || Object.keys(r.outcomes).length < 2) {
        bad(`${id} — \`outcomes\` must name at least two named actions. A review that can only decide one thing is not a review.`);
      }
      if (!('day0' in r)) {
        bad(`${id} — a \`review\` row must carry \`day0\` (a date, or null).`);
      } else if (r.day0 === null) {
        if (r.ownerGated !== true) bad(`${id} — \`day0: null\` with no \`ownerGated\` + \`ownerGap\`.`);
        prints.push(`${id} — Day 0 PENDING. Trigger: ${r.trigger ?? '<none>'}. No date may be written until it fires.`);
      } else if (!isIsoDate(r.day0)) {
        bad(`${id} — \`day0\` is not an ISO date: ${JSON.stringify(r.day0)}`);
      } else {
        const due = Date.parse(`${r.day0}T00:00:00Z`) + r.dayCount * 86_400_000;
        if (nowMs > due && !isIsoDate(r.lastDone)) {
          bad(`${id} — Day 0 (${r.day0}) + ${r.dayCount} days has passed with no recorded review.`);
        }
      }
    }

    // ── retention ────────────────────────────────────────────────────────────
    if (r.kind === 'retention') {
      retentionRows++;
      if (!nonEmpty(r.store)) bad(`${id} — a \`retention\` row must name the \`store\` it covers.`);
      if (!RETENTION_RULES.has(r.rule)) {
        bad(`${id} — \`rule\` must be one of ${[...RETENTION_RULES].join(' · ')}, got ${JSON.stringify(r.rule)}.`);
      }
      if (r.rule === 'keep' && !nonEmpty(r.keepWhy)) {
        bad(`${id} — \`rule: keep\` with no \`keepWhy\`. A keep with no written reason is how "we never got round to it" becomes a policy.`);
      }
      if (r.rule === 'ttl') ttlEnforced++;
      if (r.rule === 'period') {
        periodDeclared++;
        if (!(Number.isInteger(r.periodDays) && r.periodDays > 0)) {
          bad(`${id} — \`rule: period\` needs a positive integer \`periodDays\`.`);
        }
        // 🔴 [14]O-17's second half, armed 2026-08-06 BEFORE its domain is
        // non-empty. The acceptance is "deleted on schedule, BY A JOB" — a
        // period with nothing enforcing it is a policy sentence, which is the
        // thing the requirement exists to replace. Written now rather than on
        // the day a period is declared, because a requirement that needs new
        // code the moment the owner acts is a requirement that will be half-met.
        if (!nonEmpty(r.deletingJob)) {
          bad(
            `${id} — \`rule: period\` with no \`deletingJob\`. [14]O-17 is "deleted on schedule, BY A JOB": a ` +
              'declared period that nothing enforces is retention as a policy sentence, which is the exact state ' +
              'this requirement replaces. Name the scheduled job that sweeps this store.',
          );
        }
      }
      if (r.rule === 'period-undeclared') {
        periodUndeclared.push(`${id} (${r.store}) — ${r.ownerGap ?? '<no ownerGap>'}`);
        if (r.ownerGated !== true) {
          bad(`${id} — \`rule: period-undeclared\` must be \`ownerGated\` with an \`ownerGap\`. An undeclared period is a gap somebody owns, not a state of nature.`);
        }
      }
    }
  }

  // ── [14]O-11 · THE NULL-EXPIRY TOLERANCE, MADE LOUD AND CAPPED ────────────
  //
  // 🔴 WHAT WAS TRUE UNTIL 2026-08-06: twelve `expiring` rows, twelve
  // `expires: null`, and a tolerance that accepted every one of them because
  // `ownerGated` + `ownerGap` was present. So `daysLeft <= leadDays` — the whole
  // of the acceptance — executed ZERO times, and the guard reported clean over
  // twelve unchecked dates. The requirement was measuring ROW EXISTENCE.
  //
  // THE DECISION, and it is a decision rather than an oversight: THE TOLERANCE
  // STAYS. Not one of the twelve dates is knowable from this repository — eight
  // are in a vendor console, one is `openssl x509 -enddate` on the Oracle box,
  // one is a non-use clock with no calendar date at all, and two are business
  // values CLAUDE.md forbids mirroring into this public file — they lived in
  // gitignored `company/business/` when this was decided and moved to the shared
  // brain `nikatru/business/` under [ADR 054] on 2026-08-14. (Amended in place
  // rather than swapped: the paragraph is stamped 2026-08-06, and rewriting the
  // location outright would make the decision claim a fact that was not yet
  // true.) Requiring a date would block all of CI on owner-only work
  // (CLAUDE.md C-6, which gets guards disabled) or invite an invented one — and
  // an invented expiry is strictly worse than a null, because the arithmetic
  // would then run and PASS on a fiction.
  //
  // What the tolerance costs instead, and both of these CAN fail:
  //   · `expiryKnownAt` is mandatory (above) — the tolerance now names its source.
  //   · `_maxNull` is a CEILING that ratchets DOWN. A thirteenth null fails.
  //   · the executed-arithmetic count PRINTS, so 0-of-12 can never read as 12.
  // (The "zero `expiring` rows at all" floor is a REAL-TREE fact and lives in
  // main() beside the other domain floors — this fixture-facing half must stay
  // callable with a register that legitimately holds none.)
  if (expiringRows > 0) {
    const capNull = reg._expiryCoverage?._maxNull;
    if (!Number.isInteger(capNull) || capNull < 0) {
      bad('`_expiryCoverage._maxNull` must be a non-negative integer — it is the ceiling that stops `expires: null` from being free.');
    } else if (nullExpiries.length > capNull) {
      bad(
        `${nullExpiries.length} \`expiring\` row(s) carry \`expires: null\` and the ceiling is ${capNull}. ` +
          'This number RATCHETS DOWN as dates arrive; it never rises. Raising it is how a limb whose arithmetic ' +
          'has never executed goes on looking like coverage.',
      );
    }
    prints.push(
      `[14]O-11 — ${expiringRows} expiring row(s) · ${expiryWindowChecks} lead-window comparison(s) ACTUALLY EXECUTED · ` +
        `${nullExpiries.length} expiry UNREAD (ceiling ${capNull ?? '?'})`,
    );
    // ⏱ 2026-09-24 · O-APPLE-SIGNING-EXPIRY-UNWATCHED. THE DATES THEMSELVES, soonest
    // first, on green AND on red. The count above says how many comparisons ran;
    // only these lines say WHICH row was graded against WHICH date, and that is
    // the evidence a machine-written expiry is confirmed by — a date nobody can
    // see graded is a count, not a watch. Same rounding as the red message above.
    for (const d of [...datedExpiries].sort((a, b) => a.daysLeft - b.daysLeft)) {
      prints.push(`[14]O-11 · ${d.id} · expires ${d.expires} · ${d.daysLeft.toFixed(0)} day(s) left · lead ${d.leadDays}`);
    }
    if (expiryWindowChecks === 0) {
      prints.push(
        '[14]O-11 — 🔴 THE LEAD-WINDOW ARITHMETIC RAN ZERO TIMES ON THIS RUN. Every date is null, so nothing ' +
          'above could have failed on an expiry. Each unread date and the place it is read from:',
      );
      for (const l of nullExpiries) prints.push(`[14]O-11 —     · ${l}`);
    }
  }

  // ── [14]O-17 · THE UNDECLARED PERIOD, SAME SHAPE, SAME TREATMENT ──────────
  //
  // 🔴 ZERO retention rows declare a period, so "a query returns zero rows older
  // than the declared period" ranges over nothing and both this guard and
  // assert-retention-coverage.mjs exit 0 while printing three owner gaps.
  //
  // THE DECISION: `period-undeclared` STAYS AND IS CAPPED. The period is a
  // policy number — stage 8 owns WHAT it is, this stage owns the job that makes
  // it true — and an agent inventing one would be writing policy into a
  // published privacy commitment. What changes is that the limb is now ARMED
  // rather than absent (`rule: period` requires `deletingJob`, above), the
  // escape hatch has a ratcheting ceiling, and the executed count prints.
  if (retentionRows > 0) {
    const capUndeclared = reg._retentionCoverage?._maxUndeclared;
    if (!Number.isInteger(capUndeclared) || capUndeclared < 0) {
      bad('`_retentionCoverage._maxUndeclared` must be a non-negative integer — it is the ceiling that stops `period-undeclared` from being free.');
    } else if (periodUndeclared.length > capUndeclared) {
      bad(
        `${periodUndeclared.length} retention row(s) carry \`rule: period-undeclared\` and the ceiling is ${capUndeclared}. ` +
          'This number RATCHETS DOWN as periods are declared; it never rises. A new store may not arrive with its ' +
          'period undeclared and no cost.',
      );
    }
    prints.push(
      `[14]O-17 — ${retentionRows} retention row(s) · ${periodDeclared} declare a PERIOD, so the ` +
        `"zero rows older than the period" limb ranges over ${periodDeclared} store(s) · ` +
        `${ttlEnforced} enforce a period as a TTL the store applies itself (read out of the code by ` +
        'tooling/ci/assert-retention-coverage.mjs) · ' +
        `${periodUndeclared.length} period UNDECLARED (ceiling ${capUndeclared ?? '?'})`,
    );
    if (periodDeclared === 0) {
      prints.push(
        '[14]O-17 — 🔴 THE DELETING-JOB LIMB RANGES OVER ZERO STORES ON THIS RUN. No row declares `rule: period`, so ' +
          'nothing in THIS guard could have failed on retention. (A `ttl` row is a declared period too — it just needs no ' +
          'job, because the store expires the record itself, and assert-retention-coverage.mjs checks that against the ' +
          'code.) The periods still undeclared, and who owns each:',
      );
      for (const l of periodUndeclared) prints.push(`[14]O-17 —     · ${l}`);
    }
  }

  // ── coverage: workflows, both directions ──────────────────────────────────
  const anchored = new Map();
  for (const r of rows) {
    if (r.kind === 'duty' && nonEmpty(r?.mechanism?.anchor)) anchored.set(r.mechanism.anchor, r);
  }
  for (const wf of tree.workflows) {
    const path = `${WORKFLOW_DIR_REL}/${wf}`;
    if (!anchored.has(path)) {
      bad(
        `${path} has NO \`duty\` row anchored at it. Every workflow is a recurring duty and must declare a cadence or a written on-demand reason — ` +
          'an unclassified new workflow fails the build on purpose, because the alternative is a workflow whose silence nobody can read.',
      );
    }
  }

  // ── [14]O-10 · A CADENCE IS A CLAIM UNTIL SOMETHING READS IT ──────────────
  //
  // 🔴 THE PROMOTION. Until this limb, a `duty` row could declare `cadence:
  // "1d"` and NOTHING in the tree checked whether the thing ran daily. The
  // register enumerated the duties — a real advance over the hand-kept checklist
  // it replaced — and then took every cadence on trust, which is the same shape
  // as the undated proof `assert-platform-proof-fresh.mjs` exists to remove, one
  // level up. Two workflows genuinely have readers; nothing held them there, so
  // deleting either guard file would have left a cadence nobody checks and this
  // register still printing full coverage.
  //
  // Scoped to `github-actions` rows with a TIME cadence on purpose: a `trigger`
  // duty (ci.yml, the deploys) has no timer that can silently die, and an
  // `on-demand` one is not claimed to happen at all. Widening it to those would
  // manufacture obligations that cannot be discharged, which is how a guard
  // acquires exemptions and stops meaning anything.
  //
  // ⬜ A row with no reader does not FAIL — it must declare `freshnessGap` and
  // is PRINTED with a count on every run. `ops-watch.yml` is that row today: it
  // is the watcher, and nothing watches the watcher's ABSENCE. Failing on it
  // would block every merge on work that needs a second provider to host the
  // check, which is not this branch's to build. Zero gaps and three gaps must
  // never read alike, so the count is printed, not just the entries.
  let freshnessRead = 0;
  for (const [anchor, row] of anchored) {
    if (row?.mechanism?.substrate !== 'github-actions') continue;
    if (!TIME_CADENCE.test(String(row.cadence ?? ''))) continue;
    const wfFile = anchor.split('/').pop();
    const readBy = String(row.mechanism.readBy ?? '');
    // The reader must be a PATH THAT EXISTS, not a sentence. "the alert job in
    // X.yml" is a description of a mechanism, and a description cannot be
    // deleted by accident — which means it also cannot notice being deleted.
    const readerPath = [...readBy.matchAll(NAMED_PATH)].map((m) => m[0]).find((p) => tree.paths.has(p));
    if (!readerPath) {
      if (!nonEmpty(row.freshnessGap)) {
        bad(
          `${row.id} declares \`cadence: ${row.cadence}\` and its \`mechanism.readBy\` names no in-tree file that exists. ` +
            'A cadence nothing reads is a claim: the timer can stop and the register goes on asserting the duty happens. ' +
            'Name the reader, or declare a `freshnessGap` saying who owns the absence — which prints on every run and never blocks.',
        );
      } else {
        prints.push(`[14]O-10 — ${row.id} (cadence ${row.cadence}) has NO in-tree freshness reader: ${row.freshnessGap}`);
      }
      continue;
    }
    // ⚠️ AND IT MUST NAME **THIS** WORKFLOW, IN CODE. A reader that exists
    // proves nothing about the row that points at it: each of the two freshness
    // guards watches exactly one workflow by name, so pointing one row at the
    // other's guard leaves that cadence read by nobody.
    //
    // 🔴 THE FIRST VERSION OF THIS CHECK DID NOT CATCH THAT, AND THE MUTATION
    // RUN IS THE ONLY REASON IT IS KNOWN. Repointing build-platforms.yml's row
    // at `assert-e2e-proof-fresh.mjs` returned exit 0 — because that guard's
    // HEADER explains at length why it is a sibling of
    // `assert-platform-proof-fresh.mjs` and names `build-platforms.yml` four
    // times in prose. A comment satisfied a check about behaviour, which is the
    // exact defect a `grep '"r2_buckets"'` once hit against the template comment
    // explaining why there is no r2_buckets. Comments are stripped now.
    // The extension, not a guess: readers are .mjs guards AND `.github/workflows/
    // deploy-web.yml`, and C-family rules over YAML blank neither its `#`
    // comments nor, worse, leave an unquoted `https://…` reading as one.
    const readerSrc = stripComments(tree.readerSource?.get(readerPath) ?? '', extname(readerPath));
    if (!readerSrc.includes(wfFile)) {
      bad(
        `${row.id} names ${readerPath} as its freshness reader, and that file never mentions \`${wfFile}\`. ` +
          'A reader watching some OTHER workflow satisfies "a reader exists" and reads this cadence never — the ' +
          'guard-that-stopped-guarding shape, arriving through a pointer instead of through a regex.',
      );
      continue;
    }
    freshnessRead += 1;
  }
  prints.push(
    `[14]O-10 — ${freshnessRead} scheduled workflow duty(ies) have their cadence READ by a named in-tree guard that really names them`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // [14]O-4 · SOMETHING ON DIFFERENT INFRASTRUCTURE NOTICES THE SILENCE
  //
  // 🔴 THE SUBJECT WAS LIVE ON THE DAY THIS WAS WRITTEN, SO IT NEEDED NO
  // FIXTURE. The Windows task `ClaudeTranscriptBackup` reported
  // `LastTaskResult = 1` on 2026-08-06 (and had since 2026-08-01); its
  // destination disk `ST1000LM048-2E7172` reports HealthStatus **Warning** /
  // OperationalStatus **Predictive Failure**; `D:\ClaudeBackups` holds no folder
  // at all for 2026-08-02 or 2026-08-03. Its own exit code is the only record it
  // produces, and that record is WRITTEN BY THE THING THAT DIED. Nothing looked.
  //
  // The distinction this limb turns on, and the reason "does it have a detector"
  // was never the right question:
  //
  //   A duty FAILING is usually loud — a non-zero exit, a red job, an event.
  //   A duty CEASING is silent, and it is silent in the one way that matters:
  //   a scheduled thing that stops running produces no signal at all, and no
  //   signal is byte-identical to a portfolio with nothing wrong.
  //
  // So every scheduled duty must declare an `absenceWatcher`, and that watcher
  // must run somewhere the duty's own death cannot reach.
  //
  // ⚠️ "DIFFERENT SUBSTRATE" IS NOT A STRING COMPARISON, AND A STRING
  // COMPARISON HERE WOULD BE THE DECORATION THIS FILE EXISTS TO REFUSE.
  // `oci-cron` and `glitchtip-heartbeat` are different words for the SAME
  // ORACLE BOX — the four crontab duties on that host are watched by a GlitchTip
  // instance running on that host, so the machine failure that silences them
  // silences the watcher and the alert path in the same instant. Comparing the
  // two names would have called that "different infrastructure" and printed ok.
  // Both substrates therefore resolve through `_substrateHosts` to a member of
  // the SAME fixed provider vocabulary `_providers` uses, and the comparison is
  // on the resolved HOST. An unmapped substrate FAILS as "cannot be checked"
  // rather than passing — the rule `accessProviders` already follows, and the
  // one that makes [14]O-14 falsifiable.
  //
  // ⚠️ AND A MAPPING THAT REACHES NOTHING IS DELETED, NOT KEPT "FOR LATER".
  // An unexercised `_substrateHosts` key inflates the apparent size of the
  // domain while resolving nothing, which is the "assertion that cannot fail"
  // shape one level down. Every key must be reached by a real row.
  //
  // ─────────────────────────────────────────────────────────────────────────
  // 🔴 THE DECLARATION IS NOT THE BEHAVIOUR. THIS IS THE WHOLE LIMB.
  //
  // A row saying "a GlitchTip heartbeat monitor watches this" is one artifact
  // away from the property it claims, and this repository has now found that
  // exact stand-in six times. GlitchTip monitor 6 — "the one provably complete
  // alarm chain in the portfolio", written down as the template every other row
  // was measured against — was created with `project_id = NULL`. The checks ran,
  // the transitions were recorded, the dashboard drew them red, the alert rule
  // existed and was enabled. It went Down 13 times of 41 and TOLD NOBODY,
  // because the recipient set is a join through the project and the project was
  // null. Every surface a person looks at was healthy. A config-shaped check
  // answers a config-shaped question and would have gone green the moment the
  // foreign key was set — the same half-state, one step later.
  //
  // So a watcher is not accepted here until somebody has FORCED A REAL STATE
  // CHANGE AND WATCHED A MESSAGE LAND, and the record of that says WHEN and
  // names evidence that outlives the session (see DURABLE_ID above). Three
  // states, and every one of them costs something:
  //
  //   `downTransitionDrill`  a dated, evidenced observation. The only state that
  //                          counts as PROVEN, and the only one that increments
  //                          the proven count printed on every run.
  //   `drillDue` + `drillLeadDays` + `drillGap`
  //                          a DATED TRIPWIRE for a watcher that is genuinely
  //                          off-host but whose transition has not been forced:
  //                          prints until the lead window, RED inside it, hard
  //                          failure after. Identical semantics to
  //                          `degradedUntil`, for identical reasons — see the
  //                          `degradedLeadDays` header above, where a tripwire
  //                          with no lead window went from one quiet print
  //                          straight to blocking every branch on the day.
  //   `ownerGated` + `gap`   the repair needs a vendor console, a second
  //                          provider or the proprietor. PRINTED IN FULL on
  //                          every run and NEVER blocking (CLAUDE.md C-6: a
  //                          guard that blocks all of CI on owner-only work gets
  //                          disabled, and a disabled guard checks nothing).
  //
  // ⬜ AND THE OWNER-GATED GAPS ARE PRINTED WITH THEIR SHAPE, NOT AS ONE NUMBER.
  // "Nothing watches it at all", "the watcher shares the duty's host" and "the
  // watcher is off-host but has never been seen to fire" are three different
  // gaps with three different repairs, and rolling them into a single count is
  // how the second one hid: `duty.laptop.claude-transcript-backup` has NO
  // watcher, while the four Oracle crontab duties have one that dies with them.
  //
  // ⚠️ SCOPED TO A TIME CADENCE, with the same reasoning [14]O-10 records: a
  // `trigger` duty (ci.yml, the deploys) has no timer that can silently die, and
  // an `on-demand` one is not claimed to happen at all. Widening it to those
  // would manufacture obligations that cannot be discharged, which is how a
  // guard acquires exemptions and stops meaning anything. BOTH counts print, so
  // moving a row out of the scheduled set to escape this limb is visible.
  // ─────────────────────────────────────────────────────────────────────────
  const hostMap = reg._substrateHosts ?? {};
  const substrateHost = (s) =>
    typeof s === 'string' && !s.startsWith('_') && Object.prototype.hasOwnProperty.call(hostMap, s)
      ? hostMap[s]
      : null;
  const hostKeysUsed = new Set();

  const dutyRows = rows.filter((r) => r.kind === 'duty');
  if (dutyRows.length === 0) {
    bad(
      'COVERAGE LOST — this register declares NO `duty` row at all, so [14]O-4 quantifies over the empty set and every ' +
        'absence-watcher check below is vacuously satisfied. An undefined right-hand side rejects nothing; that is the ' +
        'state eighteen of this stage\'s criteria were already in before this register existed.',
    );
  }
  for (const [k, v] of Object.entries(hostMap)) {
    if (k.startsWith('_')) continue;
    if (!providers.has(v)) {
      bad(
        `\`_substrateHosts.${k}\` resolves to \`${v}\`, which is not in the fixed provider vocabulary ` +
          `(${[...providers].join(' · ')}). Free text on the right-hand side makes "the watcher is somewhere else" ` +
          'a comparison between two spellings rather than between two machines.',
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THE OTHER SIDE OF THE `kind === 'duty'` FILTER, AND IT FAILED SILENTLY.
  //
  // `tooling/ops/check-heartbeats.mjs` derives the cron jobs it watches with
  // `kind === 'duty' && mechanism.substrate === 'cloudflare-cron'`, and the
  // the `anchored` map in THIS file (search `const anchored = new Map()`) is built
  // from `kind === 'duty'` alone.
  // 🔴 THIS CITATION USED TO READ `:1026` AND HAD BEEN WRONG BY 13 LINES FOR MONTHS.
  // A `:NNN` pointer into the file that CONTAINS it is drift by construction: every
  // edit above it moves the target and nothing recomputes the number. Worse, the
  // 2026-08-14 [ADR 054] repair shifted the THREE EXTERNAL copies of this same
  // citation by +17 and left this one alone, so one construction had four different
  // line numbers and none of them landed on it. Naming the SYMBOL costs one grep and
  // cannot go stale. Prefer that to a line number whenever the target has a name.
  // So a NON-duty row declaring `cloudflare-cron` is invisible to both: it names
  // a scheduled Cloudflare job that NOTHING watches, and every existing limb
  // passes it. Measured 2026-08-07 by mutation — a `cloudflare-cron` substrate
  // on an `expiring` row produced no COVERAGE LOST from either reader.
  //
  // The rule is not stylistic. `cloudflare-cron` MEANS "a timer fires this on
  // Cloudflare", which is precisely what `kind: 'duty'` denotes; a row carrying
  // that substrate under any other kind is either miscategorised or has the
  // wrong substrate, and both readings end in an unwatched cron.
  //
  // ⚠️ THE LITERAL IS PINNED TO ITS READER, not hard-coded and hoped for. If
  // check-heartbeats stops keying on this exact string, the coupling this limb
  // exists to protect is gone and the limb would keep printing green over
  // nothing — the defect this repo keeps re-finding. So the string must still
  // appear in that file, and its absence is COVERAGE LOST rather than a pass.
  const CRON_SUBSTRATE = 'cloudflare-cron';
  const heartbeatReaderRel = 'tooling/ops/check-heartbeats.mjs';
  const heartbeatReaderAbs = join(ROOT, heartbeatReaderRel);
  if (!existsSync(heartbeatReaderAbs)) {
    bad(
      `COVERAGE LOST — ${heartbeatReaderRel} does not exist, so the \`${CRON_SUBSTRATE}\` coupling below is ` +
        'checked against nothing and would pass forever.',
    );
  } else {
    const heartbeatSrc = stripSourceComments(readFileSync(heartbeatReaderAbs, 'utf8'), '.mjs');
    if (!heartbeatSrc.includes(`'${CRON_SUBSTRATE}'`) && !heartbeatSrc.includes(`"${CRON_SUBSTRATE}"`)) {
      bad(
        `COVERAGE LOST — ${heartbeatReaderRel} no longer contains the literal \`${CRON_SUBSTRATE}\`, so this limb is ` +
          'guarding a coupling that no longer exists. Re-derive which substrate that reader keys on, or delete this check ' +
          '— an assertion whose subject moved is worse than none, because it still prints green.',
      );
    }
  }
  const nonDutyRows = rows.filter((r) => r.kind !== 'duty');
  let cronSubstrateScanned = 0;
  for (const r of nonDutyRows) {
    cronSubstrateScanned++;
    if (r?.mechanism?.substrate === CRON_SUBSTRATE) {
      bad(
        `${r.id ?? '<no id>'} — \`kind: "${r.kind}"\` declares \`mechanism.substrate: "${CRON_SUBSTRATE}"\`, but ` +
          `${heartbeatReaderRel} only watches rows whose \`kind\` is \`duty\`. This row names a Cloudflare cron that ` +
          'NOTHING reads the outcome of, and it passes every other limb in this guard. Either it is a scheduled duty ' +
          '(change `kind` to `duty`, which arms the absence watcher) or the substrate is wrong.',
      );
    }
  }
  prints.push(
    `[14]O-4 — \`${CRON_SUBSTRATE}\` confinement: ${cronSubstrateScanned} non-duty row(s) scanned, none declaring it; ` +
      `the literal is still present in ${heartbeatReaderRel}, so the coupling this checks is the one that exists`,
  );

  let scheduledDuties = 0;
  let watchersProven = 0;
  let watchersPending = 0;
  const absenceGaps = [];

  for (const r of dutyRows) {
    const id = r.id ?? '<no id>';
    const dutySubstrate = r?.mechanism?.substrate;
    if (nonEmpty(dutySubstrate)) {
      hostKeysUsed.add(dutySubstrate);
      if (substrateHost(dutySubstrate) === null) {
        bad(
          `${id} — \`mechanism.substrate\` \`${dutySubstrate}\` has no \`_substrateHosts\` entry, so this duty's HOST is ` +
            'unknown and "the watcher runs somewhere else" cannot be computed for it. A row that cannot be checked must ' +
            'fail rather than pass.',
        );
      }
    }
    if (!TIME_CADENCE.test(String(r.cadence ?? ''))) continue;
    scheduledDuties++;

    const aw = r.absenceWatcher;
    if (!aw || typeof aw !== 'object' || Array.isArray(aw)) {
      bad(
        `${id} — \`cadence: ${r.cadence}\` and no \`absenceWatcher\`. [14]O-4: this duty's own record is written BY THE ` +
          'THING THAT DIES, so its silence is the one state it can never report. Declare what notices the ABSENCE and ' +
          'where that thing runs — or, if closing it needs a console or a second provider, declare ' +
          '`absenceWatcher.ownerGated: true` with a written `gap`, which prints on every run and never blocks.',
      );
      continue;
    }
    if (!nonEmpty(aw.what)) bad(`${id} — \`absenceWatcher.what\` is empty. A watcher nobody names is a watcher nobody can check.`);

    const ws = aw.substrate;
    if (!nonEmpty(ws)) {
      bad(`${id} — \`absenceWatcher.substrate\` is empty. Name where the watcher RUNS, or \`${NO_WATCHER}\` if the honest answer is that nothing does.`);
      continue;
    }
    const noWatcher = ws === NO_WATCHER;
    let watcherHost = null;
    if (!noWatcher) {
      hostKeysUsed.add(ws);
      watcherHost = substrateHost(ws);
      if (watcherHost === null) {
        bad(
          `${id} — \`absenceWatcher.substrate\` \`${ws}\` has no \`_substrateHosts\` entry, so whether it shares this ` +
            'duty\'s host is UNKNOWN. "I could not tell" must never read as "it is somewhere else".',
        );
        continue;
      }
    }
    const dutyHost = substrateHost(dutySubstrate);
    const sameHost = !noWatcher && watcherHost !== null && dutyHost !== null && watcherHost === dutyHost;

    // The drill is validated WHENEVER it is present, owner-gated or not: a gap
    // does not licence an unverifiable claim sitting next to it.
    const drill = aw.downTransitionDrill;
    let drillProven = false;
    if (drill !== undefined) {
      if (!drill || typeof drill !== 'object' || Array.isArray(drill)) {
        bad(`${id} — \`absenceWatcher.downTransitionDrill\` is not an object.`);
      } else {
        let good = true;
        if (!isIsoDate(drill.date)) {
          bad(`${id} — \`downTransitionDrill.date\` is not an ISO date: ${JSON.stringify(drill.date)}`);
          good = false;
        } else if (Date.parse(`${drill.date}T00:00:00Z`) > nowMs) {
          bad(`${id} — \`downTransitionDrill.date\` is in the FUTURE (${drill.date}). A transition that has not happened cannot be dated.`);
          good = false;
        }
        if (!nonEmpty(drill.how)) {
          bad(`${id} — \`downTransitionDrill.how\` is empty. Which state was forced, and by what means, is the half a later reader needs to repeat it.`);
          good = false;
        }
        if (!nonEmpty(drill.evidence)) {
          bad(`${id} — \`downTransitionDrill.evidence\` is empty.`);
          good = false;
        } else if (!DURABLE_ID.test(drill.evidence)) {
          bad(
            `${id} — \`downTransitionDrill.evidence\` names nothing a later reader can look up: ${JSON.stringify(String(drill.evidence).slice(0, 120))}. ` +
              'A delivery-record id, a wall-clock time, an issue key or a run id — not the word "verified". Monitor 6 was ' +
              '"verified" for nine days while its recipient set was empty.',
          );
          good = false;
        }
        drillProven = good;
        if (good) {
          const ageDays = Math.floor((nowMs - Date.parse(`${drill.date}T00:00:00Z`)) / 86_400_000);
          prints.push(
            `[14]O-4 — ${id}: absence watcher on \`${ws}\` (host ${watcherHost}) vs duty on \`${dutySubstrate}\` (host ${dutyHost}); ` +
              `down-transition observed ${drill.date} (${ageDays}d ago) — ${String(drill.evidence).slice(0, 180)}`,
          );
        }
      }
    }

    if (aw.ownerGated === true) {
      if (!nonEmpty(aw.gap)) {
        bad(`${id} — \`absenceWatcher.ownerGated: true\` with no written \`gap\`. A gap nobody describes is a waiver.`);
      } else {
        const shape = noWatcher
          ? '🔴 NOTHING WATCHES ITS ABSENCE AT ALL'
          : sameHost
            ? `🔴 ITS WATCHER SHARES THE DUTY'S HOST — \`${ws}\` and \`${dutySubstrate}\` both resolve to \`${dutyHost}\`, so the failure that silences the duty silences the watcher`
            : `⬜ watcher \`${ws}\` is genuinely off-host (${watcherHost} vs ${dutyHost}) but its down-transition has never been observed`;
        absenceGaps.push(`${id} (cadence ${r.cadence}) — ${shape} — ${aw.gap}`);
      }
      continue;
    }

    // Not owner-gated: the row CLAIMS a working watcher, so it must be one.
    if (noWatcher) {
      bad(
        `${id} — \`absenceWatcher.substrate: "${NO_WATCHER}"\` is only an honest answer alongside \`ownerGated: true\` and a ` +
          'written `gap`. "Nothing watches it" is a state this register may record; it is not a state it may pass over.',
      );
      continue;
    }
    if (sameHost) {
      bad(
        `${id} — THE WATCHER RUNS ON THE THING IT WATCHES. \`absenceWatcher.substrate: ${ws}\` and ` +
          `\`mechanism.substrate: ${dutySubstrate}\` both resolve to host \`${dutyHost}\`. A watcher hosted inside the ` +
          'system it watches goes down with it and reports nothing, which is indistinguishable from "everything is fine" ' +
          '— the whole class of failure [14]O-4 names. Move it to a different host, or declare `ownerGated` with a ' +
          '`gap` so the shared-host fact PRINTS on every run instead of reading as coverage.',
      );
      continue;
    }
    if (!nonEmpty(aw.signal)) {
      bad(`${id} — \`absenceWatcher.signal\` is empty: say what ABSENCE looks like to the watcher and what it does about it. A watcher whose failing state nobody wrote down is a watcher nobody can drill.`);
    }
    if (!nonEmpty(aw.margin)) {
      bad(
        `${id} — \`absenceWatcher.margin\` is empty. An interval EQUAL to the cadence leaves ZERO margin and one late run ` +
          'reports Down — the rule Private/runbooks/backup-liveness.md establishes and the reason the Oracle box posts ' +
          'hourly against a 3h monitor. Write down how many missed runs it takes to alarm.',
      );
    }

    if (drillProven) {
      watchersProven++;
      continue;
    }
    if (drill !== undefined) continue; // already reported above

    if (!('drillDue' in aw)) {
      bad(
        `${id} — an \`absenceWatcher\` with neither a \`downTransitionDrill\` nor a dated \`drillDue\`. A DECLARED watcher ` +
          'is one artifact away from the behaviour: monitor 6 was configured, enabled, drawn red on the dashboard and ' +
          'silent for nine days because of a null foreign key. Force the transition and record it, or arm a dated ' +
          '`drillDue` (+ `drillLeadDays`, + `drillGap`) saying when it will be.',
      );
      continue;
    }
    watchersPending++;
    if (!isIsoDate(aw.drillDue)) {
      bad(`${id} — \`absenceWatcher.drillDue\` must be an ISO date (YYYY-MM-DD).`);
    } else if (!nonEmpty(aw.drillGap)) {
      bad(`${id} — \`drillDue\` with no \`drillGap\`. A deadline with no reason attached is a deadline somebody extends.`);
    } else if (!(Number.isInteger(aw.drillLeadDays) && aw.drillLeadDays > 0)) {
      bad(
        `${id} — \`drillDue\` with no positive integer \`drillLeadDays\`. Same finding as \`degradedLeadDays\`, same file: ` +
          'a dated tripwire with no lead window goes from one quiet print straight to a failure that reddens every branch ' +
          'on the day, with nothing in between.',
      );
    } else {
      const daysLeft = (Date.parse(`${aw.drillDue}T00:00:00Z`) - nowMs) / 86_400_000;
      if (daysLeft <= 0) {
        bad(
          `${id} — \`absenceWatcher.drillDue: ${aw.drillDue}\` has PASSED and the down-transition is still unobserved. ` +
            `It went red ${aw.drillLeadDays} day(s) before this, so nothing about today is a surprise. THE GAP: ${aw.drillGap} ` +
            'Force the transition and record it, or — if it turns out to need the owner — convert the watcher to ' +
            '`ownerGated` with a written `gap` so it prints forever instead of blocking. Moving the date is the one move ' +
            'this field exists to refuse.',
        );
      } else if (daysLeft <= aw.drillLeadDays) {
        bad(
          `${id} — \`absenceWatcher.drillDue: ${aw.drillDue}\` FIRES IN ${Math.ceil(daysLeft)} DAY(S), inside its own ` +
            `${aw.drillLeadDays}-day lead window, and the down-transition is still unobserved. This is the warning, on ` +
            `purpose and with time left to act. THE GAP: ${aw.drillGap}`,
        );
      } else {
        prints.push(
          `[14]O-4 — ${id}: absence watcher on \`${ws}\` is off-host but UNDRILLED. Goes RED in ` +
            `${Math.ceil(daysLeft - aw.drillLeadDays)} day(s) (${aw.drillLeadDays}-day lead window), hard failure on ` +
            `${aw.drillDue}: ${aw.drillGap}`,
        );
      }
    }
  }

  if (dutyRows.length > 0 && scheduledDuties === 0) {
    bad(
      'COVERAGE LOST — not one `duty` row carries a TIME cadence, so the [14]O-4 domain is empty and every absence-watcher ' +
        'check above ranged over nothing while this guard printed ok. Moving every duty to `trigger`/`on-demand` must not ' +
        'be the way to satisfy a criterion about scheduled duties.',
    );
  }
  for (const k of Object.keys(hostMap)) {
    if (k.startsWith('_')) continue;
    if (!hostKeysUsed.has(k)) {
      bad(
        `\`_substrateHosts.${k}\` is reached by no duty row and by no absence watcher. A mapping about nothing inflates ` +
          'the apparent size of the domain while resolving nothing — delete it, or point a row at it.',
      );
    }
  }
  prints.push(
    `[14]O-4 — ${dutyRows.length} duty row(s) scanned · ${scheduledDuties} on a CLOCK (the O-4 domain) · ` +
      `${dutyRows.length - scheduledDuties} on \`trigger\`/\`on-demand\` (no timer that can silently die) · ` +
      `${watchersProven} absence watcher(s) off-host AND proven by a dated down-transition drill · ` +
      `${watchersPending} armed drill tripwire(s) · ${absenceGaps.length} owner-gated absence gap(s)`,
  );

  // ── [14]O-7 · A DEPLOY IS NOT TRUSTED UNTIL THE LIVE SURFACE AGREES ───────
  //
  // 🔴 THE MEASURED STATE. The last step of every deploy job was
  // `record-deployment.mjs` — a step that WRITES a claim about what is live.
  // Nothing anywhere read one. So the domain here is derived from the claims
  // themselves: every job that records a deployment must also probe the surface
  // it just deployed, in THE SAME JOB. Job-level, not workflow-level, because
  // deploy-workers.yml ships two independent Workers and a single smoke
  // anywhere in the file would certify both while touching one.
  for (const d of tree.deployJobs ?? []) {
    if (d.smokes > 0) continue;
    const exemption = reg._deploySmokeExemptions?.[d.environment];
    if (nonEmpty(exemption)) {
      prints.push(`[14]O-7 — ${d.workflow}:${d.job} records \`${d.environment}\` with no smoke, exempt: ${exemption}`);
      continue;
    }
    bad(
      `${d.workflow}:${d.job} records a deployment for \`${d.environment}\` and never probes it. ` +
        'A deploy job whose last act is to WRITE a claim about what is live, with nothing reading one, is how an upload ' +
        'that shipped nothing produces a green tick and a deployment record naming the new SHA. Add a ' +
        '`tooling/ops/post-deploy-smoke.mjs` step to this job, or declare a written `_deploySmokeExemptions` entry.',
    );
  }
  // `_`-prefixed keys are the block's own prose, not exemptions. Counting them
  // would inflate the number that exists precisely so the exemption list cannot
  // grow quietly.
  const exemptCount = Object.keys(reg._deploySmokeExemptions ?? {}).filter((k) => !k.startsWith('_')).length;
  prints.push(
    `[14]O-7 — ${(tree.deployJobs ?? []).length} deploy job(s) derived from record-deployment calls; ` +
      `${(tree.deployJobs ?? []).filter((d) => d.smokes > 0).length} probe the surface they ship; ${exemptCount} written exemption(s)`,
  );

  return {
    errors,
    prints,
    stats: {
      rows: rows.length,
      onDemand,
      unverified,
      cannotRevert,
      unverifiableAnchors,
      datedTripwires,
      gaps,
      // [14]O-11 / [14]O-17 — the EXECUTION counts, not the row counts. main()
      // turns an empty domain into COVERAGE LOST; these are what let it.
      expiry: { rows: expiringRows, executed: expiryWindowChecks, unread: nullExpiries.length },
      retention: { rows: retentionRows, periods: periodDeclared, undeclared: periodUndeclared.length },
      absence: { duties: dutyRows.length, scheduled: scheduledDuties, proven: watchersProven, pending: watchersPending, gaps: absenceGaps },
    },
    anchored,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// [14]O-3 · THE READERS. Each one either answers "when did this mechanism last
// SUCCEED" or says, in one sentence, what it needed and did not have.
//
// ⚠️ EVERY READER FAILS TO `unreadable`, NEVER TO A PASS. A reader that swallows
// its own error and returns "fine" would rebuild the defect this limb replaces,
// one level down. The distinction that matters: `unreadable` means the QUERY
// could not run here (no token, wrong OS) and prints; `missing` means the query
// RAN and answered that the mechanism the register names is gone, and that is a
// hard failure — a stale row reads as coverage.
// ─────────────────────────────────────────────────────────────────────────────

const GH_API = 'https://api.github.com';
// 🔴 REPOINTED 2026-08-20. This read `Nikatru_Android_Apps_Public`, which
// `gh repo list` shows is NOT A LIVE REPOSITORY — the owner renamed it again after
// the 2026-08-19 pass that put it here. A RENAME FREES THE OLD NAME. GitHub follows
// rename redirects, so a read against the freed name answers 200 and this looked
// fine; the day somebody re-claims it, this guard reads a STRANGER'S repository and
// reports on it as if it were ours. Verify a repo name with `gh repo list`, never
// with `gh api repos/<owner>/<name>` — the redirect makes the dead name answer.
const DEFAULT_REPO = 'globalonlinedeveloper/Nikatru_Platform_Public';
const PROBE_TIMEOUT_MS = 15_000;
// 🔴 SEPARATE, AND MUCH LARGER, THAN THE NETWORK ONE — measured, not guessed. A
// COLD `powershell` start plus the ScheduledTasks module autoload exceeded 15 s
// on this laptop, and the result was not a crash: the probe timed out, reported
// `unreadable`, and the guard exited 0 with TWO GENUINELY FAILING DUTIES on the
// machine. That is this limb's own defect reappearing as a timeout — "could not
// tell" is the correct verdict for a real timeout and the wrong one for a slow
// process, and only the ceiling distinguishes them.
const LOCAL_PROBE_TIMEOUT_MS = 90_000;

const ghToken = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

async function ghJson(path) {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      authorization: `Bearer ${ghToken()}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'nikatru-ops-register',
    },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${path}`);
  return res.json();
}

// 267011 = 0x00041303 = SCHED_S_TASK_HAS_NOT_RUN. Task Scheduler's own "it is
// registered and the trigger has not fired yet" code, and the ONLY non-zero
// LastTaskResult that is not a failure.
const SCHED_S_TASK_HAS_NOT_RUN = 267011;

/** `4294770688` tells a reader nothing they can act on; `4294770688 (0xFFFD0000)`
 *  gives them a string they can search. Both forms, always, because the decimal
 *  is what PowerShell and this file's own comparisons print and the hex is what
 *  every HRESULT table is indexed by. This decodes the SHAPE of the number and
 *  deliberately asserts NOTHING about what a particular code means — the guard
 *  does not own that mapping and inventing one would be a claim it cannot check. */
export function formatTaskResult(n) {
  if (!Number.isInteger(n)) return String(n);
  return `${n} (0x${(n < 0 ? n >>> 0 : n).toString(16).toUpperCase().padStart(8, '0')})`;
}

/** THE THREE STATES A SCHEDULED TASK CAN BE IN, kept apart because they are three
 *  different facts and exactly one of them is "fine":
 *
 *    1. IT DOES NOT EXIST          -> `missing`     (hard failure: a stale register row)
 *    2. IT EXISTS AND LAST FAILED  -> `lastSuccessMs: NaN` + a LOUD detail  ← this host, today
 *    3. IT EXISTS AND NEVER RAN    -> `lastSuccessMs: NaN` + a different detail
 *
 *  and, cutting across all three, the fourth outcome that is not a state of the
 *  TASK at all but a state of the READER:
 *
 *    0. THE READ ITSELF FAILED     -> `unreadable`  (a print, never a pass, NEVER `missing`)
 *
 *  🔴 4 IS NOT 1. "I could not tell" is not "it is fine" and it is ALSO not "it is
 *  absent" — the distinction this file already draws in its [14]O-3 header and in
 *  `classifyRunRecord`. Collapsing 0 into 1 is precisely the defect fixed on
 *  2026-08-26 and described at length on `probeWindowsTasks` below. */
export function classifyScheduledTaskRow(row) {
  const task = row?.task;
  const state = row?.state;

  // ── 0 · THE READ FAILED, and NOT because the task is absent. ───────────────
  if (state === 'threw') {
    return {
      unreadable: true,
      why:
        `Get-ScheduledTaskInfo threw for "${task}", and what it threw was NOT "no such task": ${row.why}. ` +
        'That is "I could not tell whether this task exists or ran", which is neither "it is fine" nor "it is absent".',
    };
  }
  if (state !== 'read' && state !== 'absent') {
    return {
      unreadable: true,
      why: `the probe returned no usable state for "${task}" (state=${JSON.stringify(state ?? null)}), so nothing about it was actually read`,
    };
  }

  // ── 1 · THE TASK DOES NOT EXIST. An ANSWERED query, so a hard failure. ─────
  if (state === 'absent') {
    return {
      missing: true,
      why: `no scheduled task named "${task}" exists on this host — Get-ScheduledTaskInfo answered ObjectNotFound, it did not merely fail to be read`,
    };
  }

  // ── The task EXISTS and was read. Everything below is about its RESULT. ────
  const result = row.result;
  if (result !== null && result !== undefined && typeof result !== 'number') {
    // A string here would make `result === 0` silently false and report a
    // HEALTHY task as failing. Refuse to compare rather than compare wrongly.
    return {
      unreadable: true,
      why:
        `"${task}" EXISTS, but its LastTaskResult arrived as a ${typeof result} (${JSON.stringify(result)}) rather ` +
        'than a number, so it cannot be compared to 0 and no verdict about the run is available',
    };
  }

  const ran = row.lastRun ? Date.parse(row.lastRun) : NaN;
  const noRunTime = !row.lastRun || Number.isNaN(ran) || new Date(ran).getUTCFullYear() < 2000;

  // ── 3 · IT EXISTS AND HAS NEVER RUN. ──────────────────────────────────────
  if (noRunTime || result === SCHED_S_TASK_HAS_NOT_RUN) {
    const why =
      result === SCHED_S_TASK_HAS_NOT_RUN
        ? `LastTaskResult = ${formatTaskResult(result)} = SCHED_S_TASK_HAS_NOT_RUN`
        : `it reports no usable LastRunTime (${JSON.stringify(row.lastRun ?? null)})`;
    return {
      lastSuccessMs: NaN,
      detail: `"${task}" EXISTS and is scheduled, and HAS NEVER RUN — ${why}. The trigger has not fired even once.`,
    };
  }

  if (result === null || result === undefined) {
    return {
      unreadable: true,
      why: `"${task}" EXISTS and reports a LastRunTime of ${row.lastRun}, but no LastTaskResult came back at all, so whether that run succeeded is unknown`,
    };
  }

  // ── The only "fine" outcome in this whole function. ────────────────────────
  if (result === 0) {
    return {
      lastSuccessMs: ran,
      detail: `"${task}" EXISTS and its last run at ${row.lastRun} SUCCEEDED (LastTaskResult = ${formatTaskResult(0)}).`,
    };
  }

  // ── 2 · IT EXISTS AND IT IS FAILING. THE LOUD ONE. ────────────────────────
  return {
    lastSuccessMs: NaN,
    detail:
      `"${task}" EXISTS AND IS FAILING. It RAN at ${row.lastRun} and returned LastTaskResult = ` +
      `${formatTaskResult(result)}, which is not 0, so that run did not succeed. ` +
      'THIS IS NOT A MISSING TASK: the schedule is firing on time and the work under it is failing, and those ' +
      'two have opposite fixes — creating a task that already exists fixes nothing and leaves the real failure ' +
      'running. Search the hex form above for the code; this guard reports the value and deliberately does not ' +
      'interpret it. Task Scheduler keeps only the MOST RECENT result, so this record contains no successful ' +
      'run at all — not merely a stale one.',
  };
}

/** Pure. Turns ONE `spawnSync` outcome into the per-task probe map, so every
 *  branch below — wrong OS, powershell missing, non-JSON output, and each of the
 *  four states above — is reachable from a test on any platform without this
 *  host needing to own any particular scheduled task. `probeWindowsTasks` is the
 *  impure shell around it and holds no verdict logic of its own. */
export function readScheduledTaskProbe(names, spawned = {}) {
  const out = new Map();
  const everyName = (v) => {
    for (const n of names) out.set(n, v);
    return out;
  };

  const platform = spawned.platform ?? process.platform;
  if (platform !== 'win32') {
    return everyName({
      unreadable: true,
      why: `this runner is ${platform}, and Task Scheduler exists only on the Windows host the task runs on`,
    });
  }
  if (spawned.error || spawned.status !== 0) {
    return everyName({
      unreadable: true,
      why: `powershell could not be run here (${spawned.error?.message ?? `exit ${spawned.status}`})`,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(spawned.stdout);
  } catch (e) {
    return everyName({ unreadable: true, why: `Get-ScheduledTaskInfo output was not JSON (${e.message})` });
  }
  if (!Array.isArray(parsed)) {
    return everyName({ unreadable: true, why: 'Get-ScheduledTaskInfo output parsed as JSON but was not the array of task rows the probe emits' });
  }

  for (const row of parsed) out.set(row?.task, classifyScheduledTaskRow(row));
  // 🔴 A NAME THE SCRIPT NEVER ANSWERED FOR IS `unreadable`, NOT `missing`.
  // Silence is not an answer, and the same rule that forbids an overflow from
  // impersonating an absent task forbids a dropped row from doing it.
  for (const n of names) {
    if (!out.has(n)) {
      out.set(n, { unreadable: true, why: `the probe returned no row for "${n}" at all, so nothing was read about it` });
    }
  }
  return out;
}

/** Windows Task Scheduler. ONE PowerShell process for every task, and the
 *  script is passed as -EncodedCommand so a task name containing spaces or
 *  quotes cannot become a shell-quoting bug that reads as "task not found".
 *
 *  🔴 THE THING TASK SCHEDULER CANNOT TELL YOU, stated because it changes what a
 *  red verdict means: it keeps only the MOST RECENT result. `LastTaskResult = 1`
 *  therefore does not merely mean "the last run failed" — it means THERE IS NO
 *  RECORD OF ANY SUCCESS to return, which is exactly what the acceptance asks
 *  for and exactly what these two rows cannot produce today.
 *
 *  ══ 🔴 THE INVERSION THIS PROBE USED TO PERFORM · FIXED 2026-08-26 ══════════
 *  `LastTaskResult` is a `System.UInt32` carrying an HRESULT-shaped value. The
 *  emitter below used to read `result=[int]$i.LastTaskResult`, and on this host
 *
 *      [int]4294770688   ->  THROWS "Value was either too large or too small
 *                             for an Int32."
 *
 *  4294770688 is 0xFFFD0000, the REAL current value for "NIKATRU daily backup".
 *  The throw landed in this probe's OWN catch, the catch wrote `found=$false`,
 *  and the guard printed:
 *
 *      the mechanism its `recordQuery` names DOES NOT EXIST: no scheduled task
 *      named "NIKATRU daily backup" exists on this host
 *
 *  while, measured by hand the same minute, `Get-ScheduledTask -TaskName
 *  "*NIKATRU*"` returned that task at TaskPath `\` in State `Ready`, and
 *  `Get-ScheduledTaskInfo` returned LastRunTime 2026-08-26 10:00:00,
 *  LastTaskResult 4294770688, NextRunTime 2026-08-26 18:00:00. It had fired that
 *  morning. It never vanished.
 *
 *  🔴 THE INVERSION IS THE POINT, and it is why this is not a typo worth a
 *  one-line fix and no comment. A task that SUCCEEDS carries a small result (0)
 *  that casts fine and reports healthy. A task that FAILS carries a large
 *  HRESULT that overflows Int32 and was reported as NOT EXISTING. So the probe
 *  was reliable ONLY while there was nothing wrong: it was blindest exactly when
 *  there was something to see, and it silently converted the most important
 *  finding it can make — "your scheduled duty is running and failing" — into a
 *  different, quieter and actively misleading one: "you never set it up".
 *  Anybody acting on that message goes and creates a task that already exists,
 *  and the real failure survives the fix that was supposed to end it. It also
 *  corrupts the project record: "the backup has been dead six days, the task
 *  points at a pre-rename path" and "the backup fires on schedule and fails" are
 *  different facts with different fixes, and this probe asserted the first while
 *  the host was in the second.
 *
 *  THE CAST IS `[long]`, chosen against the alternatives rather than by default:
 *    · `[int]`    — Int32. Cannot hold 0x80000000..0xFFFFFFFF. THIS DEFECT.
 *    · `[uint32]` — covers the whole documented range, but THROWS on a negative
 *                   input, so the day this property is handed back already
 *                   signed (-131072 for 0xFFFE0000) the identical
 *                   overflow-into-catch reappears at the other end of the range.
 *                   A cast that can throw inside a try whose catch means
 *                   "absent" is the bug, not the width.
 *    · no cast    — leaves the JSON type to whatever the CIM provider hands
 *                   back. A value arriving as a STRING makes `result === 0` and
 *                   `result === SCHED_S_TASK_HAS_NOT_RUN` silently false and
 *                   would report a HEALTHY task as failing. The comparisons
 *                   downstream are strict, so the type must be guaranteed here.
 *    · `[long]`   — Int64. TOTAL over the full UInt32 range AND the full Int32
 *                   range, so it cannot throw for either shape; every value it
 *                   can produce is exactly representable as an IEEE754 double,
 *                   so JSON.parse round-trips it losslessly and the `=== 0` and
 *                   `=== 267011` tests stay exact. CHOSEN.
 *  `$null` is passed through as `$null` instead of being cast, because
 *  `[long]$null` is 0 and would turn "has never run" into "the last run
 *  succeeded" — the same class of lie, one branch over.
 *
 *  AND THE CATCH IS NOW HONEST. It used to collapse EVERY exception into "does
 *  not exist", which is what let a numeric overflow impersonate an absent task.
 *  It now separates the ObjectNotFound that Get-ScheduledTaskInfo raises for a
 *  genuinely absent task (measured on this host: CategoryInfo.Category =
 *  ObjectNotFound, FullyQualifiedErrorId = "HRESULT 0x80070002,Get-ScheduledTaskInfo")
 *  from anything else, and reports anything else as `unreadable` WITH the message.
 *  ═══════════════════════════════════════════════════════════════════════════ */
function probeWindowsTasks(names) {
  if (process.platform !== 'win32') return readScheduledTaskProbe(names, { platform: process.platform });
  // ⚠️ NO REGEX INSIDE A TEMPLATE SUBSTITUTION HERE, and the reason is another
  // guard's reading of this file. text-reductions.mjs walks a `${…}` as code but
  // does not recognise a regex literal inside one, so the `'` in a quote-matching
  // regex opened a phantom string there, and ~80 comment lines below this function
  // survived comment-stripping as "code". On 2026-09-11 that window came to
  // cover a comment naming ONE workflow file, and assert-release-lane-generic.mjs
  // reported this guard as bound to that lane. Doubling quotes by split/join is
  // the same PowerShell escaping with no regex for a tokenizer to misread.
  const psQuote = (n) => "'" + String(n).split("'").join("''") + "'";
  const list = names.map(psQuote).join(',');
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$names = @(${list})`,
    '$out = @()',
    'foreach ($n in $names) {',
    '  try {',
    '    $i = Get-ScheduledTaskInfo -TaskName $n -ErrorAction Stop',
    '    $lr = $null',
    "    if ($i.LastRunTime) { $lr = $i.LastRunTime.ToUniversalTime().ToString('o') }",
    // 🔴 [long], NOT [int]. See the block comment above: [int] overflows on an
    // HRESULT-shaped UInt32 and the throw would be caught below as "absent".
    '    $rc = $null',
    '    if ($null -ne $i.LastTaskResult) { $rc = [long]$i.LastTaskResult }',
    "    $out += [pscustomobject]@{ task=$n; state='read'; lastRun=$lr; result=$rc; why=$null }",
    '  } catch {',
    // 🔴 THE HONEST CATCH. "No such task" and "something else went wrong" are
    // different answers and only the first one is about the task.
    "    $absent = ($_.CategoryInfo.Category -eq 'ObjectNotFound') -or ($_.FullyQualifiedErrorId -like '*0x80070002*') -or ($_.FullyQualifiedErrorId -like '*NotFound*')",
    "    $state = if ($absent) { 'absent' } else { 'threw' }",
    '    $msg = ("" + $_.Exception.GetType().Name + ": " + $_.Exception.Message)',
    '    $out += [pscustomobject]@{ task=$n; state=$state; lastRun=$null; result=$null; why=$msg }',
    '  }',
    '}',
    'ConvertTo-Json -InputObject @($out) -Compress',
  ].join('\n');
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    timeout: LOCAL_PROBE_TIMEOUT_MS,
  });
  return readScheduledTaskProbe(names, { platform: 'win32', error: r.error, status: r.status, stdout: r.stdout });
}

/** The newest SUCCESSFUL run for the declared event. `event=schedule` matters:
 *  a workflow_dispatch green run proves somebody pressed a button, which is the
 *  opposite of what a cadence claim means. Same distinction
 *  assert-e2e-proof-fresh.mjs makes, for the same reason. */
/** PURE. Turns ONE run-history answer into a probe result, so every branch of
 *  the verdict is reachable from a test without a network — the same shell/pure
 *  split `probeGlitchtipHeartbeat` / `classifyGlitchtipChecks` already uses.
 *  `probeGithubRun` below is the impure shell and holds no verdict logic. */
export function classifyRunHistoryAnswer(q, newest, repo) {
  const on = q.headBranch ? ` on ${q.headBranch}` : '';
  if (!newest) {
    return {
      lastSuccessMs: NaN,
      detail: `${repo} has NO successful \`${q.event ?? 'any'}\` run of ${q.workflow}${on} in its run history at all.`,
    };
  }
  // 🔴 THE FILTER IS THE REQUEST; THIS IS THE ANSWER, CHECKED. A query parameter
  // silently ignored by a future API version would widen this guard with nothing
  // to notice — the same reason the ceiling keys in this file are asserted rather
  // than trusted. `branch=` is a request; `head_branch` is what came back.
  // ⏱ 2026-09-11 — this used to return `lastSuccessMs: NaN`, which
  // `classifyRunRecord` grades as "holds NO SUCCESSFUL RUN AT ALL", exit 1: an API
  // that stopped honouring `branch=` would report every duty as broken rather than
  // unread (REVIEW-guards-2026-09-10 #8). An answer that does not hold is UNREADABLE (INV6).
  if (q.headBranch && newest.head_branch !== q.headBranch) {
    return {
      unreadable: true,
      why:
        `${repo} answered with run ${newest.id} on branch ${JSON.stringify(newest.head_branch ?? null)} for a query ` +
        `that asked for ${JSON.stringify(q.headBranch)}. The branch filter did not hold, so no verdict about ` +
        `${q.headBranch} is available — that is UNREADABLE, never "no successful run at all".`,
    };
  }
  return {
    lastSuccessMs: Date.parse(newest.updated_at),
    detail: `run ${newest.id} (${q.event ?? 'any'}${on}) succeeded at ${newest.updated_at}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE ANSWER'S SHAPE WAS CHECKED AND ITS RECENCY WAS NOT — a `per_page=1`
// read believed on sight. Added 2026-09-09, coverage unit `stale-run-page`.
//
// ── THE DEFECT, MEASURED RATHER THAN REASONED ───────────────────────────────
// Both readers below asked GitHub for one run and took it. The filter checks
// they already carry — `head_branch` is the answer, `conclusion` is the answer —
// validate WHAT came back and never WHEN, so a read replica serving an old page
// satisfies every one of them and is believed.
//
// MEASURED 2026-09-09, inside run 34351841295: the freshness read answered run
// 32560795997, a scheduled ops-watch success from 2026-08-22 — 436.7h stale —
// while the SAME query, issued again, returned run 34332836726 from that
// morning. Same URL, same filters, two different histories.
//
// ── WHY IT CUTS BOTH WAYS, WHICH IS WHY IT IS NOT MERELY NOISE ──────────────
//   · FRESHNESS ([14]O-3)  — a stale success INVENTS a red: the newest green
//                            looks 436h old and the duty reads as gone stale.
//   · RED-SINCE ([14]O-3b) — a stale FAILURE read HIDES a red: the newest
//                            failure looks older than the newest success and a
//                            broken `main` grades green.
// A guard that can be talked into either answer by a cache is not evidence.
//
// ── THE FIX: TWO READS AT TWO WIDTHS, AND A REFUSAL WHEN THEY DISAGREE ──────
// Every question is asked twice, concurrently, at `per_page=1` and
// `per_page=30`. Two widths rather than the same request twice ON PURPOSE: a
// different `per_page` is a different cache key, so the second read cannot be
// served the first one's cached page — repeating one URL would mostly re-read
// one replica and prove nothing.
//
// A stale replica can only OMIT recent runs; it can never invent a run that has
// not happened. So the two reads disagreeing means one of them is provably
// behind, and the newer answer is the true one. This code nevertheless REFUSES
// rather than quietly taking it, with one bounded exception: a run that genuinely
// COMPLETES between two concurrent requests is a real race, and it is
// distinguishable, because such a run finished seconds ago. So a disagreement is
// accepted as a race only when the newer run completed within
// `RUN_READ_RACE_MS` of now; anything older is replica staleness and throws.
//
// A throw here is `unreadable` at both call sites — it prints, it never passes,
// and it never reds. That is the honest verdict for "GitHub served me two
// histories": not a green, not a red, and visible on every run.
//
// ⚠️ `newestOnPage` scans for the maximum `updated_at` instead of taking entry
// zero. Newest-first is a promise the API makes; this file does not take
// promises, for the same reason the filter checks exist at all.
export const RUN_READ_RACE_MS = 120_000;
const RUN_READ_WIDE = 30;

/** PURE. The newest run on one page by `updated_at`, never `runs[0]`. */
export function newestOnPage(runs) {
  let best = null;
  for (const r of runs ?? []) {
    if (!r?.updated_at) continue;
    if (!best || Date.parse(r.updated_at) > Date.parse(best.updated_at)) best = r;
  }
  return best;
}

/** PURE. Reconciles the two independent reads of ONE run-history question, so
 *  every branch of the refusal is reachable from a test without a network —
 *  the same shell/pure split the classifiers above already use. */
export function reconcileRunReads(narrow, wide, what, nowMs = Date.now()) {
  if ((narrow?.id ?? null) === (wide?.id ?? null)) return narrow ?? wide ?? null;
  const at = (r) => (r ? Date.parse(r.updated_at) : -Infinity);
  const newer = at(wide) > at(narrow) ? wide : narrow;
  const staleBy = nowMs - at(newer);
  if (staleBy <= RUN_READ_RACE_MS) return newer;
  const say = (r, w) => (r ? `per_page=${w} answered run ${r.id} at ${r.updated_at}` : `per_page=${w} answered NO run`);
  throw new Error(
    `two reads of ${what} disagreed, and the gap is not a race: ${say(narrow, 1)}, ` +
      `while ${say(wide, RUN_READ_WIDE)}. The newer of the two completed ` +
      `${(staleBy / 3_600_000).toFixed(1)}h ago — far outside the ${RUN_READ_RACE_MS / 1000}s window in which a run ` +
      `finishing between two concurrent requests could explain it — so GitHub served an inconsistent view of this ` +
      `history and NO verdict is available from it. A stale page can invent a red in the freshness limb and hide ` +
      `one in RED-SINCE, so this refuses rather than believing either answer.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-12 · ONE PAGE PER WORKFLOW, PLUS ONE CROSS-CHECK — 56 REQUESTS -> 20.
//
// 🔴 THE COST, MEASURED RATHER THAN ESTIMATED. Under a counting `fetch` preload
// on origin/main db68b1f4, one enforcing run of this guard made 56 GitHub
// requests: 46 distinct paths and 10 exact duplicates. 44 of them were run-list
// reads — 22 questions, each asked TWICE (per_page=1 and per_page=30) — about
// exactly NINE workflows on ONE branch. GITHUB_TOKEN is allowed 1,000 requests
// an hour per repository, and on 2026-09-11 this guard spent about 1,600 of a
// morning's 2,225 before every lane died on `API rate limit exceeded for
// installation`.
//
// ── WHAT CHANGED, AND WHAT DID NOT ──────────────────────────────────────────
// The two-width cross-check above is NOT weakened: it still happens, still at
// two different `per_page` values (so still two different cache keys), still
// refusing when the two histories disagree outside the race window. What changed
// is its GRAIN. It used to be per QUESTION — `event=schedule&status=success`,
// `status=failure`, `status=completed` and the rest each bought their own pair
// of reads of the same nine histories. It is now per (workflow, branch): ONE
// wide page and ONE narrow cross-check, and every question about that workflow
// is answered by SELECTING from the page that was already fetched.
//
// 9 workflows x 2 reads = 18, plus the job list of one run and one search =
// 20 requests where there were 56. Re-measured the same way, same preload.
//
// ── WHY THE PAGE IS WIDER THAN THE ONE IT REPLACES ──────────────────────────
// `RUN_PAGE_WIDE` is 100, not 30. The old wide read was already FILTERED, so 30
// entries meant 30 SCHEDULED COMPLETED runs; an unfiltered page of 30 on a busy
// branch could hold three. Asking for the API's maximum costs the same one
// request and leaves the unit scan below strictly MORE history than it had, not
// less — which matters, because `pageFull` is how that scan says "my answer may
// be truncated" and a narrower page would have made it say so more often.
//
// ── THE FILTER CHECKS MOVED WITH THE FILTERS ────────────────────────────────
// `branch=` is still a SERVER-side filter, so it is still checked against the
// answer, once per page rather than once per question — a `branch=` a future API
// version ignored would still be caught here. `event` and `status` are now
// selected in this process, so a check that they "held" would be a check on this
// file's own `filter` call: an assertion that cannot fail, which this repository
// deletes rather than keeps. What replaced it is a check that CAN fail and
// matters more — a run whose `conclusion` is null (still running, or cancelled
// into nothing) is never selected as the newest success or the newest failure.
//
// ── WHEN THE PAGE CANNOT ANSWER ─────────────────────────────────────────────
// A page of 100 that holds no matching run may be truncated rather than empty.
// So "no match and the page was FULL" falls back to the targeted two-width read
// for that one question, exactly as before. "No match and the page was not full"
// is the complete history of that branch, so "there is no such run" is a fact,
// not a guess.
// ─────────────────────────────────────────────────────────────────────────────
const RUN_PAGE_WIDE = 100;

/** PURE. Splits the `filters` array the callers build into the parts that are
 *  asked of GitHub (`branch`) and the parts selected here (`event`, `status`). */
export function splitRunFilters(filters) {
  const out = { branch: null, event: null, status: null, unknown: [] };
  for (const f of (filters ?? []).filter(Boolean)) {
    const [k, v] = String(f).split('=');
    const value = decodeURIComponent(v ?? '');
    if (k === 'branch') out.branch = value;
    else if (k === 'event') out.event = value;
    else if (k === 'status') out.status = value;
    else out.unknown.push(f);
  }
  return out;
}

/** PURE. The runs on a page that answer one question. `status` follows the API's
 *  own vocabulary: `completed` is a run STATE, anything else is a CONCLUSION.
 *  A run with no `conclusion` has not concluded and answers neither. */
export function selectRuns(runs, { event = null, status = null } = {}) {
  return (runs ?? []).filter((r) => {
    if (!r?.updated_at) return false;
    if (event && r.event !== event) return false;
    if (!status) return true;
    if (status === 'completed') return r.status === 'completed' && r.conclusion !== null && r.conclusion !== undefined;
    return r.conclusion === status;
  });
}

/** IMPURE. ONE cross-checked page of a workflow's runs on a branch, memoised for
 *  the whole guard run. Two reads at two widths, reconciled by the block above;
 *  the narrow read's answer is merged in, so a run that finished between the two
 *  requests is still visible to every question. */
function branchPage(repo, workflow, branch, cache) {
  const key = `${repo}|${workflow}|${branch ?? ''}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const br = branch ? `branch=${encodeURIComponent(branch)}&` : '';
        const path = (n) => `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?${br}per_page=${n}`;
        const what = `the run history of ${workflow}${branch ? ` on ${branch}` : ''}`;
        const [narrow, wide] = await Promise.all([ghJson(path(1)), ghJson(path(RUN_PAGE_WIDE))]);
        if (!Array.isArray(narrow?.workflow_runs) || !Array.isArray(wide?.workflow_runs)) {
          throw new Error(`the run list for ${what} came back without a workflow_runs array`);
        }
        const newest = reconcileRunReads(newestOnPage(narrow.workflow_runs), newestOnPage(wide.workflow_runs), what);
        const byId = new Map();
        for (const r of [...wide.workflow_runs, ...(newest ? [newest] : [])]) {
          if (r?.updated_at && !byId.has(r.id)) byId.set(r.id, r);
        }
        const runs = [...byId.values()].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        // The one filter that is still GitHub's, checked against GitHub's answer.
        if (branch) {
          for (const r of runs) {
            if (r.head_branch !== branch) {
              throw new Error(
                `the branch filter did not hold for ${workflow}: asked for ${JSON.stringify(branch)} and run ${r.id} ` +
                  `came back on ${JSON.stringify(r.head_branch ?? null)}`,
              );
            }
          }
        }
        return anchoredBranchPage(repo, workflow, branch, runs, wide.workflow_runs.length >= RUN_PAGE_WIDE); // stale-run-page anchor, see file end
      })(),
    );
  }
  return cache.get(key);
}

/** Per-process page cache. One map for the whole run: every question about a
 *  workflow on a branch reads the page the first question fetched. */
const RUN_PAGES = new Map();

/** The impure shell for one run-history question: SELECTED from the shared
 *  cross-checked page, with a targeted two-width read only when the page was
 *  full and held no match. Holds no verdict logic. */
async function ghNewestRun(repo, workflow, filters, what) {
  const { branch, event, status, unknown } = splitRunFilters(filters);
  if (unknown.length === 0) {
    const { runs, pageFull } = await branchPage(repo, workflow, branch, RUN_PAGES);
    const hit = selectRuns(runs, { event, status })[0] ?? null;
    if (hit || !pageFull) return hit;
  }
  // FALLBACK — the page was full and held no match, so the answer may be older
  // than the page. Ask the question directly, at both widths, exactly as before.
  const qs = filters.filter(Boolean).join('&');
  const path = (n) => `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?${qs}&per_page=${n}`;
  const [narrow, wide] = await Promise.all([ghJson(path(1)), ghJson(path(RUN_READ_WIDE))]);
  return reconcileRunReads(newestOnPage(narrow?.workflow_runs), newestOnPage(wide?.workflow_runs), what);
}

/** The newest SUCCESSFUL run for the declared event AND branch. `event=schedule`
 *  matters: a workflow_dispatch green run proves somebody pressed a button, which
 *  is the opposite of what a cadence claim means. `branch` matters for a reason
 *  that is currently INVISIBLE — see the schema limb above. The impure shell only. */
async function probeGithubRun(q, repo) {
  const ev = q.event ? `event=${encodeURIComponent(q.event)}` : '';
  const br = q.headBranch ? `branch=${encodeURIComponent(q.headBranch)}` : '';
  const newest = await ghNewestRun(
    repo,
    q.workflow,
    [ev, br, 'status=success'],
    `the newest successful ${q.event ?? 'any'} run of ${q.workflow}${q.headBranch ? ` on ${q.headBranch}` : ''}`,
  );
  return classifyRunHistoryAnswer(q, newest, repo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 INV3 · A DUTY IS JUDGED BY THE UNIT THAT PERFORMS IT, NEVER BY A RUN THAT
// ALSO PERFORMS OTHERS. Added 2026-09-11.
//
// ── THE DEFECT, MEASURED ────────────────────────────────────────────────────
// Four rows read `ops-watch.yml`'s history through `status=success`, which is a
// WHOLE-RUN conclusion: duty.analytics-silence-judgment, duty.d1-statement-
// acceptance, duty.pages-deployment-landed and duty.workflow.ops-watch.yml. From
// 2026-09-10T06:13Z every ops-watch run failed in ONE place — the register step
// of job `heartbeats`, which is this guard — while the analytics step, the D1
// step and job `pages-deployments` concluded `success` in every one of those runs
// (read from /actions/runs/{id}/jobs for runs 34444234613 … 34544690996). The
// whole-run reader could not see that. All four aged past 36h together and sat
// in the problem list of run 34546423386 at 2026-09-11T00:26Z; one red limb aged
// four unrelated duties, and one of the four was the watcher's own row, so the
// run that could have cleared them could not go green.
//
// ── THE UNIT, NAMED ON THE ROW AND HELD AGAINST THE WORKFLOW FILE ────────────
// `recordQuery.unit` is REQUIRED on every run-history row (`checkRunUnits`):
//   · "run"                   — the run IS the duty. Legal only when no other row
//                               reads that workflow and it does not run this guard.
//   · { "jobs": [id, …] }     — every named job concludes `success` (a job skipped
//                               by its OWN `if:` is neutral), and at least one does.
//   · { "job": id, "step": n } — that step concludes `success`.
// A job or step unit is read from /actions/runs/{id}/jobs, newest completed run
// first, over the same two-width cross-checked run page every other read uses,
// and the job lists are cached per run for the whole guard run. A cancelled,
// skipped or absent unit renders NO verdict and the scan moves to the next run.
// ─────────────────────────────────────────────────────────────────────────────

export const RUN_UNIT = 'run';
export const UNIT_PAGE = RUN_READ_WIDE;
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 · A RUN THAT DIED ON THE QUOTA DID NOT FAIL ITS DUTY.
//
// 🔴 MEASURED: CodeQL runs 34570837477 (06:43Z) and 34577720776 (08:12Z), push
// on main, each concluded `failure` in ONE step — "Analyze" of job "Analyze
// JavaScript and TypeScript" — and the only failure-level annotation GitHub
// recorded on either job is `API rate limit exceeded for installation`. The
// analysis never reached a verdict about the code; GitHub refused the job's
// token. [14]O-3b graded both as duty.workflow.codeql.yml RED SINCE, main's
// register went red, and the remedy it printed ("dispatch the workflow once the
// cause is fixed") named a cause that does not exist in the repository.
//
// So a newest failure is looked at once more before it is called RED: every job
// of that run that concluded failure is read for the failure annotations GitHub
// recorded, and when EVERY one of them is the installation-quota refusal the row
// is COVERAGE LOST (exit 2 wherever it blocks) — "I could not tell", which is
// what that run is — never RED (exit 1, "the duty is failing"). Anything
// unread, empty or mixed is NOT proven and keeps the verdict it had. The read
// costs one job list and one annotation list per failed job, only for a row
// whose newest failure is newer than its newest success.
// ─────────────────────────────────────────────────────────────────────────────
export const INSTALLATION_QUOTA_REFUSAL = /API rate limit exceeded for installation/;

/** PURE. Did this run fail ONLY because GitHub refused its token the
 *  installation quota? `jobs` is the run's /jobs answer; `annotationsOf(jobId)`
 *  the annotation list of that job's check run, or null when it could not be
 *  read. `{ quotaOnly, why }`: true only when at least one job failed, every
 *  failed job carries a failure-level annotation, and every failure-level
 *  annotation of every failed job is the refusal. */
export function diedOnlyOnInstallationQuota(jobs, annotationsOf) {
  if (!Array.isArray(jobs)) return { quotaOnly: false, why: 'the run came with no job list' };
  const failed = jobs.filter((j) => FAILED_CONCLUSIONS.has(j?.conclusion));
  if (failed.length === 0) return { quotaOnly: false, why: 'no job of the run concluded failure' };
  for (const j of failed) {
    const list = annotationsOf(j?.id);
    if (!Array.isArray(list)) return { quotaOnly: false, why: `the annotations of job "${j?.name}" could not be read` };
    const failures = list.filter((a) => a?.annotation_level === 'failure');
    if (failures.length === 0) return { quotaOnly: false, why: `job "${j?.name}" recorded no failure annotation` };
    const other = failures.find((a) => !INSTALLATION_QUOTA_REFUSAL.test(String(a?.message ?? '')));
    if (other) return { quotaOnly: false, why: `job "${j?.name}" failed on: ${String(other.message ?? '').slice(0, 160)}` };
  }
  return {
    quotaOnly: true,
    why: `${failed.map((j) => `job "${j?.name}"`).join(' · ')} failed ONLY on \`API rate limit exceeded for installation\``,
  };
}

/** IMPURE. The cause of one failed run, for `diedOnlyOnInstallationQuota`. A
 *  read that throws is "not proven", never "quota". */
async function quotaCauseOfRun(repo, runId, cache) {
  let jobs;
  try {
    jobs = await jobsOfRun(repo, runId, cache);
  } catch (e) {
    return { quotaOnly: false, why: `the job list of run ${runId} could not be read (${e.message})` };
  }
  const annotations = new Map();
  for (const j of jobs.filter((x) => FAILED_CONCLUSIONS.has(x?.conclusion))) {
    try {
      annotations.set(j.id, await ghJson(`/repos/${repo}/check-runs/${j.id}/annotations?per_page=100`));
    } catch {
      annotations.set(j.id, null);
    }
  }
  return diedOnlyOnInstallationQuota(jobs, (id) => annotations.get(id) ?? null);
}

/** IMPURE. Marks a redness probe's failure with its cause when that failure is
 *  the newer term — the only case in which the cause can change the verdict. */
async function withQuotaCause(probe, repo, cache) {
  const { success, failure } = probe ?? {};
  if (!failure) return probe;
  const failMs = Date.parse(failure.at);
  const okMs = success ? Date.parse(success.at) : NaN;
  if (success && !(Number.isFinite(failMs) && Number.isFinite(okMs) && failMs > okMs)) return probe;
  const cause = await quotaCauseOfRun(repo, failure.id, cache);
  failure.quotaOnly = cause.quotaOnly;
  failure.cause = cause.why;
  return probe;
}

/** PURE. The unit a run-history query names, normalised. An ABSENT unit reads as
 *  the whole run, so a row is graded exactly as before until `checkRunUnits`
 *  (which refuses the absence) is satisfied. */
export function unitOf(q) {
  const u = q?.unit;
  if (u === undefined) return { kind: 'run', declared: false };
  if (u === RUN_UNIT) return { kind: 'run', declared: true };
  if (u && typeof u === 'object' && !Array.isArray(u)) {
    if (Array.isArray(u.jobs) && u.job === undefined && u.step === undefined) return { kind: 'jobs', jobs: u.jobs.map(String), declared: true };
    if (nonEmpty(u.job) && nonEmpty(u.step) && u.jobs === undefined) return { kind: 'step', job: String(u.job), step: String(u.step), declared: true };
  }
  return { kind: 'invalid', raw: u, declared: true };
}

/** PURE. The unit in words, for every line a unit row prints. */
export function describeUnit(q) {
  const u = unitOf(q);
  if (u.kind === 'run') return `the whole ${q?.workflow} run`;
  if (u.kind === 'jobs') return `job(s) ${u.jobs.join(' + ')} of ${q?.workflow}`;
  if (u.kind === 'step') return `step "${u.step}" of job ${u.job} in ${q?.workflow}`;
  return `an unreadable unit of ${q?.workflow}`;
}

/** PURE. Is this parsed job a reusable-workflow CALL — a job-level `uses:` (four
 *  spaces: a job's keys, never a step's) in place of steps? */
export const isCallJob = (job) => (job?.lines ?? []).some((l) => /^ {4}uses:\s*\S/.test(String(l?.text ?? '')));

/** ⏱ 2026-09-25 [ADR 095 §4] The one sentence every call-job shape that was not
 *  measured ends in. G1-G3 were measured on real runs; how GitHub lists a call
 *  job that is skipped AS A WHOLE was not, so a run that lists the call job in
 *  no shape at all is COVERAGE LOST (exit 2), never "absent, so neutral". */
export const G4_UNMEASURED = 'G4: whole-call-job skip shape unmeasured (cloud-drafts/pd2b/d2b2-ruling-verify.md)';

/** PURE. Does an API job `name` belong to workflow job `jobId`? The API reports a
 *  job by its `name:` with expressions substituted, and a matrix leg with its
 *  values appended in parentheses; a job with no `name:` by its id.
 *  ⏱ 2026-09-25 [ADR 095 §4] A CALL job has no conclusion of its own that the
 *  API reports while it runs: its jobs come back as `<call job> / <callee job>`.
 *  Without this arm `{ jobs: ["deploy-web"] }` matched only the skipped
 *  placeholder and never a real conclusion — neutral forever, a silent green.
 *  The arm is taken only for a job whose own key is `uses:`. */
export function apiJobMatcher(jobId, job) {
  const display = nonEmpty(job?.displayName) ? job.displayName : String(jobId);
  if (isCallJob(job)) {
    return (name) => {
      const n = String(name ?? '');
      return n === display || n.startsWith(`${display} / `);
    };
  }
  if (display.includes('${{')) {
    const body = display
      .split(/\$\{\{[^}]*\}\}/)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+');
    const re = new RegExp(`^${body}(?: \\(.+\\))?$`);
    return (name) => re.test(String(name ?? ''));
  }
  return (name) => {
    const n = String(name ?? '');
    return n === display || n.startsWith(`${display} (`);
  };
}

/** PURE. ONE run's verdict for ONE unit: `{ verdict: 'success' | 'failure' |
 *  'neutral' | 'lost', detail }`. `apiJobs` is that run's /jobs answer; `wf` the parsed
 *  workflow the unit's ids are declared in. Neutral is "this run says nothing
 *  about the unit" — never a pass. Lost is a call job in a shape nobody measured
 *  (`G4_UNMEASURED`) — COVERAGE LOST, never neutral. */
export function unitConclusion(q, run, apiJobs, wf) {
  const u = unitOf(q);
  if (u.kind === 'run') {
    const c = run?.conclusion ?? null;
    return {
      verdict: c === 'success' ? 'success' : FAILED_CONCLUSIONS.has(c) ? 'failure' : 'neutral',
      detail: `run ${run?.id} concluded ${JSON.stringify(c)}`,
    };
  }
  if (u.kind === 'invalid') return { verdict: 'neutral', detail: 'the row names no readable unit' };
  if (!wf) return { verdict: 'neutral', detail: `${q?.workflow} could not be parsed, so no job of run ${run?.id} can be matched to the unit` };
  if (!Array.isArray(apiJobs)) return { verdict: 'neutral', detail: `run ${run?.id} came with no job list` };
  const parts = [];
  const eachApiJob = (id, visit) => {
    const job = wf.jobs?.get?.(id);
    if (!job) { parts.push({ what: `job ${id}`, c: 'neutral', why: 'is not declared in the workflow file' }); return; }
    const match = apiJobMatcher(id, job);
    const found = apiJobs.filter((j) => match(j?.name));
    if (isCallJob(job)) {
      // ⏱ 2026-09-25 [ADR 095 §4] THREE SHAPES, and only two of them measured:
      // children present → grade the children; exactly one entry named just the
      // call job, `skipped` → the lane was skipped; anything else → `lost`.
      const display = nonEmpty(job.displayName) ? job.displayName : String(id);
      const own = found.filter((j) => String(j?.name ?? '') === display);
      const children = found.filter((j) => String(j?.name ?? '') !== display);
      if (children.length) { for (const j of children) visit(job, j); return; }
      if (own.length === 1 && own[0]?.conclusion === 'skipped') {
        parts.push({
          what: `job ${id}`,
          c: nonEmpty(job.jobIf?.cond) ? 'skipped-by-own-if' : 'neutral',
          why: `was skipped as a whole in run ${run?.id} (one entry "${display}", no "${display} / …" child)`,
        });
        return;
      }
      parts.push({
        what: `call job ${id}`,
        c: 'lost',
        why: own.length === 0
          ? `has NO entry in run ${run?.id}, neither "${display}" nor "${display} / …". ${G4_UNMEASURED}`
          : `came back in run ${run?.id} as ${own.length} entry(ies) named "${display}" (${own.map((j) => JSON.stringify(j?.conclusion ?? null)).join(', ')}) and no child. ${G4_UNMEASURED}`,
      });
      return;
    }
    if (found.length === 0) { parts.push({ what: `job ${id}`, c: 'neutral', why: `is absent from run ${run?.id}` }); return; }
    for (const j of found) visit(job, j);
  };
  if (u.kind === 'jobs') {
    for (const id of u.jobs) {
      eachApiJob(id, (job, j) => {
        const c = j?.status && j.status !== 'completed' ? null : (j?.conclusion ?? null);
        if (c === 'success') parts.push({ what: `job ${id}`, c: 'success' });
        else if (FAILED_CONCLUSIONS.has(c)) parts.push({ what: `job ${id}`, c: 'failure', why: `concluded ${c}` });
        else if (c === 'skipped' && nonEmpty(job.jobIf?.cond)) parts.push({ what: `job ${id}`, c: 'skipped-by-own-if', why: `was skipped by its own \`if: ${job.jobIf.cond}\`` });
        else parts.push({ what: `job ${id}`, c: 'neutral', why: `concluded ${JSON.stringify(c)}` });
      });
    }
  } else {
    eachApiJob(u.job, (job, j) => {
      const s = (j?.steps ?? []).find((x) => x?.name === u.step);
      const c = s ? (s.conclusion ?? null) : undefined;
      if (!s) parts.push({ what: `step "${u.step}"`, c: 'neutral', why: `is not among the steps job ${u.job} reported in run ${run?.id}` });
      else if (c === 'success') parts.push({ what: `step "${u.step}"`, c: 'success' });
      else if (FAILED_CONCLUSIONS.has(c)) parts.push({ what: `step "${u.step}"`, c: 'failure', why: `concluded ${c}` });
      else parts.push({ what: `step "${u.step}"`, c: 'neutral', why: `concluded ${JSON.stringify(c)}` });
    });
  }
  // 2 beats 1: a run whose call job came back in an unmeasured shape is
  // "could not tell", whatever else in the unit concluded.
  const lost = parts.filter((p) => p.c === 'lost');
  if (lost.length) return { verdict: 'lost', detail: `run ${run?.id}: ${lost.map((p) => `${p.what} ${p.why}`).join(' · ')}` };
  const failed = parts.filter((p) => p.c === 'failure');
  if (failed.length) return { verdict: 'failure', detail: `run ${run?.id}: ${failed.map((p) => `${p.what} ${p.why}`).join(' · ')}` };
  const silent = parts.filter((p) => p.c === 'neutral');
  if (silent.length || !parts.some((p) => p.c === 'success')) {
    return { verdict: 'neutral', detail: `run ${run?.id}: ${silent.map((p) => `${p.what} ${p.why}`).join(' · ') || 'nothing in the unit concluded success'}` };
  }
  return { verdict: 'success', detail: `run ${run?.id}: ${describeUnit(q)} succeeded` };
}

/** PURE. The freshness probe from a scanned, newest-first `[{ run, c }]`. A full
 *  page with no success is not "never": it carries `noSuccessSinceMs`, the oldest
 *  run read, so the verdict can say how far back the silence was measured. */
export function decideUnitFreshness(q, entries, pageFull, repo) {
  const on = ` on ${q?.headBranch}`;
  const ev = q?.event ?? 'any';
  const hit = (entries ?? []).find((e) => e.c?.verdict === 'success');
  if (hit) {
    return {
      lastSuccessMs: Date.parse(hit.run.updated_at),
      detail: `run ${hit.run.id} (${ev}${on}): ${describeUnit(q)} succeeded; the run completed at ${hit.run.updated_at}.`,
    };
  }
  const oldest = entries?.length ? entries[entries.length - 1].run : null;
  if (pageFull && oldest) {
    return {
      lastSuccessMs: NaN,
      noSuccessSinceMs: Date.parse(oldest.updated_at),
      detail: `${repo}: NO success of ${describeUnit(q)} in the newest ${entries.length} completed \`${ev}\` run(s)${on}, back to run ${oldest.id} at ${oldest.updated_at}.`,
    };
  }
  return { lastSuccessMs: NaN, detail: `${repo} has NO successful ${describeUnit(q)} in any completed \`${ev}\` run${on} in its run history at all.` };
}

/** PURE. The redness probe from a scanned, newest-first `[{ run, c }]`, in the
 *  shape `classifyRedSince` already reads. The newest DECISIVE run decides: a
 *  success first is green; failures first are RED SINCE the newest of them. */
export function decideUnitRedSince(q, entries, pageFull) {
  let failure = null;
  for (const e of entries ?? []) {
    // ⏱ 2026-09-25 [ADR 095 §4] A `lost` run NEWER than every decisive one is
    // the row's answer: COVERAGE LOST. Older than a failure already found, it
    // cannot un-red that failure, so the scan reads past it for the success term.
    if (e.c?.verdict === 'lost' && !failure) return { lost: { id: e.run.id, at: e.run.updated_at, detail: e.c.detail } };
    if (e.c?.verdict === 'success') {
      return failure
        ? { success: { id: e.run.id, at: e.run.updated_at }, failure }
        : { success: { id: e.run.id, at: e.run.updated_at }, failure: null, newestDecisive: true };
    }
    if (e.c?.verdict === 'failure' && !failure) failure = { id: e.run.id, at: e.run.updated_at, detail: e.c.detail };
  }
  const oldest = entries?.length ? entries[entries.length - 1].run : null;
  if (failure && pageFull && oldest) return { success: { id: null, at: oldest.updated_at, beyondPage: entries.length }, failure };
  return { success: null, failure };
}

/** ⏱ 2026-09-18 · O-LAPTOP-ROUTINES-DIE-OVERNIGHT. PURE. A `duty.laptop.*` row may
 *  carry `liveVerdictScope: { blocks: 'page-only', page: '<workflow>.yml', why }`:
 *  its RED live verdict then BLOCKS only in that page host and PRINTS everywhere
 *  else. The owner chose it (2026-09-18) for work that is laptop-bound by
 *  construction — a Claude desktop routine that writes the remote-less Private
 *  repo — so a closed lid pages (ops-watch goes red) but stops freezing main's
 *  `ci-gate` and every deploy lane that polls it.
 *
 *  The exemption is NARROW BY STRUCTURE, and each refusal here blocks in every
 *  host: only `duty.laptop.*` rows; `blocks` must be exactly `page-only`; the
 *  page must be a workflow this guard actually runs in (`topology.guardHosts`) —
 *  otherwise the verdict would block NOWHERE, which is deletion by another name;
 *  and `why` must say why. Every scoped row is PRINTED on every run.
 *  Returns `{ errors, prints }`. */
export function checkLiveVerdictScopes(reg, topology) {
  const errors = [];
  const prints = [];
  for (const r of reg?.rows ?? []) {
    const sc = r?.liveVerdictScope;
    if (sc === undefined) continue;
    const id = String(r?.id ?? '<no id>');
    if (!id.startsWith('duty.laptop.')) {
      errors.push(`${id}: carries \`liveVerdictScope\` and is not a duty.laptop.* row. The page-only scope exists for work that only a sleeping laptop can do; on any other row it would quietly stop a live verdict from gating deploys.`);
      continue;
    }
    if (sc?.blocks !== 'page-only') {
      errors.push(`${id}: \`liveVerdictScope.blocks\` is ${JSON.stringify(sc?.blocks)}; the only scope is "page-only".`);
      continue;
    }
    if (!nonEmpty(sc?.page) || !(topology?.guardHosts instanceof Set) || !topology.guardHosts.has(sc.page)) {
      errors.push(`${id}: \`liveVerdictScope.page\` is ${JSON.stringify(sc?.page ?? null)}, which is not a workflow that runs this guard (${[...(topology?.guardHosts ?? [])].sort().join(', ') || 'none derived'}). A page that never runs the guard would make this verdict block NOWHERE.`);
      continue;
    }
    if (!nonEmpty(sc?.why) || String(sc.why).trim().length < 40) {
      errors.push(`${id}: \`liveVerdictScope.why\` is missing or too short. An exemption from the deploy gate must say why, in words a later reader can check.`);
      continue;
    }
    prints.push(`PAGE-ONLY · ${id} — a red live verdict blocks only in ${sc.page} and PRINTS in every other host. ${sc.why}`);
  }
  return { errors, prints };
}

/** PURE. INV3 + INV4 in the register: every run-history row names a unit, the
 *  unit exists in the workflow file, no unit contains this guard's own verdict,
 *  units of rows sharing a workflow do not overlap, and every job of a shared
 *  workflow is some row's unit. `parsedByFile` is `file -> parseWorkflow(...)`.
 *  Returns `{ errors, prints }`; every error is STRUCTURAL and blocks in every host. */
export function checkRunUnits(reg, parsedByFile, topology) {
  const errors = [];
  const prints = [];
  const postGate = postGateAdmission(parsedByFile, topology);
  const byFile = new Map();
  for (const r of reg?.rows ?? []) {
    const q = r?.mechanism?.recordQuery;
    if (q?.reader !== 'github-run-history') continue;
    const f = String(q.workflow ?? '');
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(r);
  }
  for (const [file, group] of byFile) {
    const wf = parsedByFile?.get?.(file) ?? null;
    const shared = group.length > 1;
    const jobOwner = new Map();
    const stepOwner = new Map();
    for (const r of group) {
      const q = r.mechanism.recordQuery;
      const u = unitOf(q);
      if (!u.declared) {
        errors.push(
          `${r.id} — \`recordQuery\` reads the run history of ${file} and names no \`unit\`. [INV3] A duty is judged by ` +
            'the job or step that PERFORMS it: "run" when the whole run is this one duty, { "jobs": [...] }, or ' +
            '{ "job", "step" }. A whole-run read of a run that performs several duties is how one red limb aged four ' +
            'unrelated duties on 2026-09-11 (run 34546423386).',
        );
        continue;
      }
      if (u.kind === 'invalid') {
        errors.push(`${r.id} — \`recordQuery.unit: ${JSON.stringify(u.raw)}\` is not "run", { "jobs": [id, …] } or { "job": id, "step": name }, so nothing can be read for it.`);
        continue;
      }
      if (u.kind === 'run') {
        if (shared) {
          errors.push(
            `${r.id} — \`unit: "run"\` on ${file}, which ${group.length} rows read (${group.map((g) => g.id).join(' · ')}). ` +
              '[INV3] A run that performs several duties is the unit of none of them: its conclusion goes red for any one ' +
              'of them and ages all the others. Name the job or step that performs THIS duty.',
          );
        }
        if (topology?.guardHosts?.has(file)) {
          errors.push(
            `${r.id} — \`unit: "run"\` on ${file}, which runs ${GUARD_SCRIPT_REL}: the whole run contains this guard's ` +
              `own verdict, so this duty could not go green in ${file} until ${file} is green. [INV4] No host requires itself.`,
          );
        }
        continue;
      }
      if (!wf) {
        errors.push(`${r.id} — names ${u.kind === 'jobs' ? 'jobs' : 'a step'} of ${file}, and ${WORKFLOW_DIR_REL}/${file} could not be parsed, so the unit cannot be held against the file that declares it.`);
        continue;
      }
      const ids = u.kind === 'jobs' ? u.jobs : [u.job];
      if (ids.length === 0) {
        errors.push(`${r.id} — \`unit.jobs\` is EMPTY. A unit of nothing concludes nothing, and a duty judged by it could never be seen to fail.`);
        continue;
      }
      const unknown = ids.filter((id) => !wf.jobs.has(id));
      if (unknown.length) {
        errors.push(`${r.id} — \`unit\` names job(s) ${unknown.map((x) => `\`${x}\``).join(' · ')}, which ${WORKFLOW_DIR_REL}/${file} does not declare (it declares ${[...wf.jobs.keys()].join(' · ')}).`);
        continue;
      }
      if (u.kind === 'step') {
        const names = jobSteps(wf.jobs.get(u.job)).map((s) => s.name).filter(Boolean);
        if (!names.includes(u.step)) {
          errors.push(
            `${r.id} — \`unit.step: ${JSON.stringify(u.step)}\` is not the name of a step in job ${u.job} of ${file} ` +
              `(named steps: ${names.map((n) => JSON.stringify(n)).join(' · ') || 'none'}). The API reports a step by its ` +
              'name, so a near-miss matches nothing and the duty would read as never performed.',
          );
          continue;
        }
      }
      const why = unitNeedsGuard(wf, u, topology);
      if (why && postGateUnit(q, postGate)?.ok) {
        // ⏱ 2026-09-25 [ADR 095 §4] The one exemption: every job of the unit is
        // post-gate, so it cannot redden its own run's gate, and its route is
        // OWN HOST — it PRINTS in this file and blocks in the other guard hosts.
        prints.push(
          `[INV4] ${r.id} — every job of its unit (${u.jobs.join(' · ')}) is post-gate in ${file}: ${why}. OWN HOST — ` +
            `its red PRINTS in ${file} and blocks in every other guard host.`,
        );
      } else if (why) {
        errors.push(
          `${r.id} — its unit contains this guard's own verdict: ${why}. [INV4] No host requires itself — judged by ` +
            `that unit, this duty could not go green in ${file} while ${file} is red, and ${file} is red whenever this guard is.`,
        );
      }
      if (u.kind === 'jobs') {
        for (const id of ids) {
          if (jobOwner.has(id)) errors.push(`${r.id} — job ${id} of ${file} is already the unit of ${jobOwner.get(id)}. [INV3] Two duties judged by one job are one duty's red ageing the other.`);
          else jobOwner.set(id, r.id);
        }
      } else {
        const key = `${u.job}::${u.step}`;
        if (stepOwner.has(key)) errors.push(`${r.id} — step "${u.step}" of job ${u.job} in ${file} is already the unit of ${stepOwner.get(key)}. [INV3] One step is one duty.`);
        else stepOwner.set(key, r.id);
      }
    }
    for (const [key, owner] of stepOwner) {
      const job = key.split('::')[0];
      if (jobOwner.has(job)) errors.push(`${owner} — is judged by a step of job ${job} in ${file}, and ${jobOwner.get(job)} is judged by that whole job: the units overlap, so one of them ages the other. [INV3]`);
    }
    // ⏱ 2026-09-25 [ADR 095 §4] For the gate workflow completeness ranges over
    // its post-gate jobs only (below); its other jobs are the gate's own business.
    if (shared && wf && postGate?.gateWorkflow !== file) {
      const stepJobs = new Set([...stepOwner.keys()].map((k) => k.split('::')[0]));
      const unowned = [...wf.jobs.entries()]
        .filter(([id, j]) => !jobOwner.has(id) && !stepJobs.has(id) && !workflowRunsScript({ lines: j.lines }, GUARD_SCRIPT_REL))
        .map(([id]) => id);
      if (unowned.length) {
        errors.push(
          `${WORKFLOW_DIR_REL}/${file} is read by ${group.length} duty rows and job(s) ${unowned.join(' · ')} are the unit of none ` +
            'of them. A whole-run read covered them by accident; a unit read does not, so a failure there would be watched ' +
            'by nobody in this register. Add each to the `unit.jobs` of the row whose duty it performs.',
        );
      }
      prints.push(`[INV3] ${file} — ${group.length} duty rows, each judged by its OWN unit: ${group.map((g) => `${g.id} ← ${describeUnit(g.mechanism.recordQuery)}`).join(' · ')}`);
    }
  }
  // ⏱ 2026-09-25 [ADR 095 §4] INV3 for the gate workflow: every post-gate job is
  // the unit of exactly one row (two is refused above as an overlap). Ranged
  // whether one row reads the gate workflow or none — a post-gate job is a lane
  // that runs after the gate, and one no row reads is a red nobody is paged for.
  if (postGate) {
    const owners = new Map([...postGate.jobs].map((j) => [j, []]));
    for (const r of byFile.get(postGate.gateWorkflow) ?? []) {
      const u = unitOf(r.mechanism.recordQuery);
      if (u.kind === 'jobs') for (const j of u.jobs) owners.get(j)?.push(r.id);
    }
    const unowned = [...owners].filter(([, o]) => o.length === 0).map(([j]) => j);
    if (unowned.length) {
      errors.push(
        `${WORKFLOW_DIR_REL}/${postGate.gateWorkflow} — post-gate job(s) ${unowned.join(' · ')} (needs \`${postGate.gateJob}\`, ` +
          `\`if: ${POST_GATE_IF}\`) are the unit of no row. [INV3] A post-gate job is a lane that runs after the gate on ` +
          'main; red, it would be watched by nobody in this register. Give each a `duty.workflow.*` row whose ' +
          `\`recordQuery\` reads ${postGate.gateWorkflow} with \`unit: { "jobs": [id] }\`.`,
      );
    }
    prints.push(
      `[INV3] ${postGate.gateWorkflow} — ${owners.size} post-gate job(s)` +
        (owners.size ? `, each the unit of: ${[...owners].map(([j, o]) => `${j} ← ${o.join(' · ') || 'NONE'}`).join(' · ')}` : ''),
    );
  }
  return { errors, prints };
}

/** IMPURE. One cross-checked page of COMPLETED runs for a unit read, newest first,
 *  every run's branch checked against the question. A shape or branch that does
 *  not hold THROWS, and a throw is `unreadable` at both call sites. */
async function unitRunsPage(q, repo, filters, what) {
  if (!nonEmpty(q?.headBranch)) throw new Error(`${q?.workflow} names no headBranch, so a unit read cannot be scoped to a branch`);
  const { branch, event, status, unknown } = splitRunFilters(filters);
  if (unknown.length === 0 && branch === q.headBranch) {
    // ⏱ 2026-09-12 — the SAME shared page every other read of this workflow uses
    // (see "ONE PAGE PER WORKFLOW" above). It is fetched once and cross-checked
    // once; the four ops-watch duty rows that each bought their own pair of reads
    // of this identical history now buy none. The branch check moved into the
    // page, where the branch filter still is.
    const { runs, pageFull } = await branchPage(repo, q.workflow, branch, RUN_PAGES);
    return { runs: selectRuns(runs, { event, status }), pageFull };
  }
  const qs = filters.filter(Boolean).join('&');
  const path = (n) => `/repos/${repo}/actions/workflows/${encodeURIComponent(q.workflow)}/runs?${qs}&per_page=${n}`;
  const [narrow, wide] = await Promise.all([ghJson(path(1)), ghJson(path(UNIT_PAGE))]);
  if (!Array.isArray(narrow?.workflow_runs) || !Array.isArray(wide?.workflow_runs)) {
    throw new Error(`the run list for ${what} came back without a workflow_runs array`);
  }
  reconcileRunReads(newestOnPage(narrow.workflow_runs), newestOnPage(wide.workflow_runs), what);
  const runs = wide.workflow_runs.filter((r) => r?.updated_at).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  for (const r of runs) {
    if (r.head_branch !== q.headBranch) {
      throw new Error(`the branch filter did not hold for ${q.workflow}: asked for ${JSON.stringify(q.headBranch)} and run ${r.id} came back on ${JSON.stringify(r.head_branch ?? null)}`);
    }
  }
  return { runs, pageFull: wide.workflow_runs.length >= UNIT_PAGE };
}

/** Pages of 100 read before a run's job list is refused as too long to walk. */
export const RUN_JOB_PAGES = 10;

/** PURE given `fetchPage(page)`. ⏱ 2026-09-25 [ADR 095 §4] One run's WHOLE job
 *  list. A job on page 2 of a one-page read reads ABSENT, which is neutral, which
 *  is a silent green — and ci.yml's job count grows with every call child. So the
 *  pages are walked until `total_count` is reached, and a list that does not add
 *  up THROWS (unreadable at both call sites), never a short answer. */
export async function collectRunJobs(runId, fetchPage) {
  const jobs = [];
  for (let page = 1; page <= RUN_JOB_PAGES; page++) {
    const body = await fetchPage(page);
    if (!Array.isArray(body?.jobs)) throw new Error(`the job list of run ${runId} came back without a jobs array (page ${page})`);
    if (!Number.isInteger(body?.total_count)) throw new Error(`the job list of run ${runId} came back without a total_count, so a job past page ${page} would read as absent`);
    jobs.push(...body.jobs);
    if (jobs.length >= body.total_count) return jobs;
    if (body.jobs.length === 0) throw new Error(`run ${runId} reports ${body.total_count} job(s) and page ${page} came back empty after ${jobs.length}`);
  }
  throw new Error(`run ${runId} lists more than ${RUN_JOB_PAGES * 100} jobs, so the rest would read as absent`);
}

/** IMPURE. One run's job list, cached for the whole guard run. Page 1 keeps the
 *  URL it always had. */
function jobsOfRun(repo, runId, cache) {
  if (!cache.has(runId)) {
    const base = `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`;
    cache.set(runId, collectRunJobs(runId, (page) => ghJson(page === 1 ? base : `${base}&page=${page}`)));
  }
  return cache.get(runId);
}

async function scanUnit(q, repo, wf, cache, filters, what) {
  const u = unitOf(q);
  if (u.kind === 'invalid' || u.kind === 'run') throw new Error(`${q?.workflow}: a unit scan was asked for a ${u.kind} unit`);
  const { runs, pageFull } = await unitRunsPage(q, repo, filters, what);
  const entries = [];
  for (const run of runs) {
    const c = unitConclusion(q, run, await jobsOfRun(repo, run.id, cache), wf);
    entries.push({ run, c });
    if (c.verdict === 'success') break;
  }
  return { entries, pageFull };
}

async function probeUnitFreshness(q, repo, wf, cache) {
  const ev = q.event ? `event=${encodeURIComponent(q.event)}` : '';
  const { entries, pageFull } = await scanUnit(
    q, repo, wf, cache,
    [ev, `branch=${encodeURIComponent(q.headBranch)}`, 'status=completed'],
    `the newest completed ${q.event ?? 'any'} runs of ${q.workflow} on ${q.headBranch}`,
  );
  return decideUnitFreshness(q, entries, pageFull, repo);
}

async function probeUnitRedSince(q, repo, wf, cache) {
  const { entries, pageFull } = await scanUnit(
    q, repo, wf, cache,
    [`branch=${encodeURIComponent(q.headBranch)}`, 'status=completed'],
    `the newest completed runs of ${q.workflow} on ${q.headBranch}`,
  );
  return withQuotaCause(decideUnitRedSince(q, entries, pageFull), repo, cache);
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 [14]O-3b · RED SINCE — THE LIMB THAT GRADES A FAILED RUN, NOT MERELY A
// MISSING SUCCESSFUL ONE. Added 2026-09-07, coverage unit `alarm-on-red`,
// [ADR 067] decision 4.
//
// ── THE DEFECT, READ OUT OF THIS FILE'S OWN SOURCE ──────────────────────────
// `probeGithubRun` above asks GitHub for `status=success`. A failed run is not
// ignored by the verdict logic — IT NEVER ARRIVES. So the only thing that could
// ever notice `main` going red was the STALENESS window quietly expiring:
// `duty.workflow.build-platforms.yml` is a `7d` duty against a
// `7d x 1.5 = 252h` window, so a run that FAILS is invisible for up to ten and a
// half days, and even then it surfaces as "the newest SUCCESSFUL run is old",
// which reads like a quiet week rather than like a broken build. It bit this
// repository for three days in the week of 2026-09-01. TRAPS `ci-38` states the
// general form: NOTHING IN THIS PORTFOLIO GRADES A FAILED RUN — ONLY THE AGE OF
// THE NEWEST GREEN — SO A RED `main` IS SILENCE, NOT AN ALARM.
//
// ── WHY THIS IS A SECOND QUERY AND NOT A WIDER FILTER ───────────────────────
// Dropping `status=success` from the cadence query would destroy the cadence
// claim: `lastSuccessMs` would begin reporting the newest run of ANY conclusion,
// so a workflow failing every single night would look the freshest of all. The
// two claims are therefore read from two answers — the same split Worker cron
// Phase 2 made between the TIMER and the OUTCOME:
//   · FRESHNESS — newest SUCCESS for the declared event (`probeGithubRun`).
//   · REDNESS   — newest SUCCESS **and** newest FAILURE on the declared branch,
//                 EVENT FILTER DROPPED, and the two timestamps ordered.
//
// 🔴 AND THE EVENT FILTER MUST BE DROPPED HERE. That is not an oversight, it is
// the case that would produce a false alarm. `duty.workflow.codeql.yml` reads
// `event: schedule` for its cadence, and codeql also runs on `push` to `main`.
// If the redness comparison reused that filtered success, a `push` run that
// FAILED at T2 would be compared against the newest SCHEDULED success at
// T1 < T2 and reported RED — while a later `push` success at T3 > T2 had already
// made `main` green again. A false alarm on the merge queue is how a guard gets
// switched off. So both halves are read at the SAME width (branch only) and the
// answer means exactly what it says: on this branch, for this workflow, is the
// newest failure newer than the newest success.
//
// ── WHAT IT DOES WHEN IT FIRES: THE DUTY IS FAILING ─────────────────────────
// Not a new severity, not a new channel, and deliberately not a print. The
// register already defines a duty whose record says the mechanism failed as
// FAILING — every row in this domain carries `failingValue: "conclusion =
// failure …"` in its own words — and `evaluateRunRecords` already blocks on
// that. So this limb speaks the register's existing vocabulary and routes into
// `errors`. Which means, concretely: `ci-gate` red on every branch until the
// branch is green again, and, within at most one ops-watch slot (twelve a day),
// the `alert` job in `.github/workflows/ops-watch.yml`
// (`if: failure() && github.event_name == 'schedule'`) files it against the
// durable issue "Scheduled duty is not reporting healthy". That is the page, and
// it is the chain that already exists.
//
// `tooling/ops/alarm-chains.json` is deliberately NOT touched. It ledgers
// GlitchTip monitor → recipient chains — "if that MONITOR goes red, does a human
// find out" — and this finding does not travel a monitor. It travels the
// workflow-failure chain, which is exercised on every red ops-watch run.
//
// ⚠️ THE FREEZE IS BOUNDED AND ITS REMEDY IS REACHABLE, which is the property
// that decides whether a blocking alarm is honest rather than merely loud. Every
// workflow in this domain accepts `workflow_dispatch`, and the comparison
// accepts a success of ANY event — so one dispatched green run on the branch
// clears the red immediately, with no merge required.
//
// ⛔ APPENDED 2026-09-08 — TRUE FOR EVERY ROW IN THIS DOMAIN EXCEPT ONE: THE
// WORKFLOW THAT HOSTS THIS GUARD. `.github/workflows/ops-watch.yml` runs this
// file, and `duty.workflow.ops-watch.yml` is a `1d` row in this domain — so the
// limb was grading the run history of the very run it was executing inside. The
// probe filters on CONCLUSIONS (`status=success` and `status=failure`), and an
// IN-FLIGHT RUN HAS NO CONCLUSION, so the grading run can never supply its own
// success. One red ops-watch run therefore became the newest failure; the next
// run read it, exited 1, and became the newest failure in turn. Red forever —
// and `ci-gate` red on every pull request with it, because `ci.yml` runs this
// same guard in `guards-platform`. No dispatch, no merge and no wait could clear
// it: the sentence above was the one thing this row could not be given. Measured
// 2026-09-08 in `Private/pre-prune-2026-09-08:research/full-read-2026-09-08/F1-deploy-fix-2026-09-08.md`
// §0 — four consecutive ops-watch failures on `main`, all newer than the newest
// success. TRAPS `ci-42`/`ci-43` state the general form: A RUN'S OWN CONCLUSION
// MAY NOT BE AN INPUT TO THE GRADE THAT PRODUCES IT, and a cadence job placed on
// the event it measures cannot be repaired in place — move the reader off the
// event.
//
// ➡️ THE REPAIR, AND IT NARROWS NOTHING. When this guard runs inside a GitHub
// Actions job, the ONE row whose watched workflow file is the HOST workflow file
// is routed to a NAMED PRINT (`SELF …`) instead of being graded: never a pass,
// never a `green`, still counted in the domain size, and it names the reader that
// does grade it. Every OTHER host still grades it hard. `ci.yml` is
// `cadence: trigger`, is outside this domain for the deadlock reason stated
// below, and runs this guard on every push and every pull request — so a
// genuinely red `ops-watch.yml` still turns `ci-gate` red on every branch and the
// alarm keeps its whole bite. Only the self-fulfilling in-run copy of the verdict
// is downgraded to a print. The empty-domain refusal below is untouched, and the
// deferred row is still IN the domain it counts. See `hostWorkflowFile` and the
// `self` verdict in `evaluateRedSince`.
//
// 🔴 THAT IS ALSO WHY THE DOMAIN IS THE SCHEDULED PROOFS AND NOT EVERY
// `duty.workflow.*` ROW. `ci.yml`, `deploy-web.yml`, `deploy-workers.yml` and
// `site-drift-repair.yml` are `cadence: trigger` rows: `ci.yml`'s newest run on
// `main` can be made green only BY MERGING, so blocking merges on it would be a
// deadlock with no exit at all — the `ci-18` bootstrap shape, one level up, and
// this repository has already paid ~46h of frozen queue for a milder version of
// it. A red `ci.yml` on `main` is looked at by the checks on the pull request
// that produced it; a red nightly proof is looked at by nobody, and that is the
// gap this limb closes. The exclusion is named here rather than discovered.
//
// ⏱ APPENDED 2026-09-09 — THAT PARAGRAPH IS STILL TRUE OF `ci.yml`, AND IT WAS
// BEING APPLIED TO THREE ROWS IT WAS NEVER ARGUED FOR. The reason above is a
// DEADLOCK argument — "green only BY MERGING" — and it holds for exactly one
// workflow. `deploy-web.yml` and `deploy-workers.yml` both declare
// `workflow_dispatch:` in their own `on:` block, so a red deploy lane has an
// exit that costs one button press and no merge at all. They were nevertheless
// excluded, because the filter was `cadence: trigger` and not "has this row an
// exit".
//
// 🔴 WHAT THAT COST, MEASURED: run 34315492291, `deploy-web.yml`, `main`, sha
// 43ab0224, conclusion FAILURE at 2026-09-09T05:35Z. The web deploy lane went
// red on the default branch and NOTHING alarmed. Not this limb (the row is
// `trigger`, so it was not in the domain); not the [14]O-3 freshness limb (that
// one ranges over `TIME_CADENCE` rows too, and a trigger row has no window to
// age out of); not ops-watch (it files against the duties it reads, and it does
// not read this one). The only reader was the checks on the push that produced
// it — i.e. a human happening to look — which is precisely the "a red X is
// looked at by nobody" gap this whole limb was built to close, one row type
// over. TRAPS `ci-38` again, on the rows the first fix stepped around.
//
// ➡️ THE ADMISSION, AND IT IS DERIVED RATHER THAN LISTED. A `duty.workflow.*`
// row on `cadence: trigger` joins this domain when — and only when — the
// workflow file it names DECLARES `workflow_dispatch`, read out of
// `.github/workflows/<file>` by `workflowEvents` (workflow-scan.mjs, the one
// workflow parser). Not a hand-set boolean and not a second list: this file's
// standing objection to a list is that a list can be SHORTENED to close an
// alarm, and a declared `dispatchable: true` is a list of one wearing a
// different hat. The property that makes a blocking alarm honest is "the remedy
// is reachable without a merge", the workflow file is where that property
// actually lives, and so that is what is read.
//
// ⬜ AND THE TWO ROWS THAT STAY OUT, NAMED HERE RATHER THAN INFERRED:
//   · `ci.yml`             — `on:` is `push` + `pull_request`, NO
//                            `workflow_dispatch`. Its newest run on `main` can
//                            be made green only by merging, so grading it is
//                            the deadlock the paragraph above refuses. The
//                            derivation reaches that same answer on its own.
//   · `site-drift-repair.yml` — `on:` is `push: branches: [main]` alone, NO
//                            `workflow_dispatch`. Same shape, same answer: a red
//                            run there is cleared by the next push to `main`,
//                            which is a merge. Excluded, and it is excluded by
//                            the DERIVATION rather than by being left off a list
//                            somebody could put it back on.
// The moment either file grows a `workflow_dispatch:` trigger it joins the
// domain automatically, and the moment a deploy workflow LOSES one it leaves —
// which is a shrink, so `evaluateRedSince` PRINTS every trigger row it did not
// admit, with the reason, on every run. A domain that can shrink in silence is
// the defect; a domain that shrinks in a printed sentence is a decision.
//
// 🔴 WHAT IS GRADED HERE IS REDNESS, NEVER STALENESS, AND THE SPLIT IS THE WHOLE
// REASON A CLOCKLESS ROW CAN BE ADMITTED AT ALL. `classifyRedSince` asks one
// question — is the newest failure newer than the newest success — and it is an
// ORDERING of two timestamps with no window, no grace and no `cadenceDays()` in
// it anywhere. `cadenceDays('trigger')` returns `null`, and every limb that
// needs it ([14]O-3's freshness window, `missedRunsTolerated`, `firstDue`) is
// gated behind `TIME_CADENCE` and CONTINUES to exclude these rows. A trigger row
// has no clock, so it is never asked a question about one: "this lane has not
// run lately" is not a claim this limb may make about a workflow that runs when
// somebody pushes. `redSinceTriggerShape` refuses the clock fields on these rows
// outright, so the split cannot be blurred later by adding one.
//
// ── AND WHY `assert-platform-proof-fresh.mjs` GETS NO COPY OF THIS ──────────
// It reads `build-platforms.yml`'s run history independently and also asks for
// `status=success`. A second copy of this rule is exactly what `grep-10`
// forbids, and it would buy nothing: `build-platforms.yml` IS
// `duty.workflow.build-platforms.yml`, this limb grades it, and both guards run
// in the SAME `ci.yml` job (`Guards - platform, data and ops`) with the same
// token — so a red `build-platforms` already fails that job here. Its
// `status=success` read stays what it is: a FRESHNESS and PROVENANCE read, not a
// redness read.
// ─────────────────────────────────────────────────────────────────────────────

/** The file a `duty.workflow.*` row is about: the workflow its `recordQuery`
 *  names, or — for a row that carries no query at all — the basename of its
 *  `mechanism.anchor` when that anchor is a workflow file. The second half
 *  exists so the exclusion census below can give `duty.workflow.ci.yml` a REASON
 *  ("ci.yml declares no workflow_dispatch") instead of the uselessly true
 *  "this row names no workflow". */
export function rowWorkflowFile(row) {
  const named = row?.mechanism?.recordQuery?.workflow;
  if (nonEmpty(named)) return String(named);
  const anchor = String(row?.mechanism?.anchor ?? '');
  return anchor.startsWith(`${WORKFLOW_DIR_REL}/`) ? anchor.split('/').pop() : null;
}

/** IMPURE, and it is the ONE impure input to the domain: which workflow files on
 *  disk declare `workflow_dispatch`, i.e. which red lanes have an exit that is
 *  not a merge. ⏱ 2026-09-09.
 *
 *  It goes through `parseAllWorkflows` + `workflowEvents` — the single workflow
 *  parser this repository owns — rather than a regex here, for the reason stated
 *  at the import: four copies of a workflow parse drift in the way that reports
 *  "clean", and the first thing that drifts is which lines it can see at all.
 *
 *  Returned as a SET OF FILENAMES because that is what a `recordQuery.workflow`
 *  and the GitHub API path both use. */
export function dispatchableWorkflows(root) {
  const out = new Set();
  for (const wf of parseAllWorkflows(root)) {
    if (workflowEvents(wf).has('workflow_dispatch')) out.add(String(wf.rel ?? '').split('/').pop());
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 A DISPATCH BUTTON IS NOT AN EXIT WHEN THE DISPATCHED RUN'S FIRST STEP IS
// THE GATE THIS VERDICT JUST REDDENED. Added 2026-09-09, coverage unit
// `red-since-self-gate`. TRAPS `ci-42`/`ci-43` again — a run's own conclusion may
// not be an input to the grade that produces it — one hop further out.
//
// ── THE LIVELOCK, MEASURED ON `main` RATHER THAN REASONED ───────────────────
// 1. `build-platforms.yml` run 34351523027 FAILED on `main` at
//    2026-09-09T12:45:45Z (Windows MAX_PATH; cause fixed by merged PR #582).
// 2. `classifyRedSince` graded it `red` and `evaluateRedSince` pushed the line
//    into `errors`, so this guard exits 1.
// 3. This guard runs in `ci.yml`'s `guards-platform` job, and `ci-gate` `needs:`
//    that job — so `ci-gate` went red on `main` (runs 34354769442 on ee582aef
//    and 34355401877 on ddfc63d4, both for exactly this line).
// 4. `build-platforms.yml`'s FIRST step is
//    `node tooling/ci/assert-gate-passed.mjs ${{ github.sha }}`. Observed in run
//    34355529015 on ddfc63d4: `✗ ci-gate concluded "failure" for ddfc63d4 —
//    refusing to deploy`. The dispatched run aborts before it builds anything.
// 5. So `build-platforms.yml` can never produce a green run on `main`, so RED
//    SINCE never clears, so `ci-gate` never goes green.
//
// ⚠️ AND THE LOOP HAD A SECOND LAP. `.github/workflows/ops-watch.yml` RUNS THIS
// GUARD, so step 2 also failed ops-watch (run 34354893475, 2026-09-09T13:06:44Z),
// which made `duty.workflow.ops-watch.yml` RED SINCE in turn — and ops-watch is
// not self-gated, so exempting only the self-gated row left `ci-gate` red through
// the ops-watch row instead.
//
// ⛔ 2026-09-11 — THOSE TWO RULES (AND THE 2026-09-08 `SELF` ROW) WERE THREE
// INSTANCES OF ONE CLASS, AND THE REST OF THE CLASS FROZE `main` FOR GOOD.
// Measured (FINDING-permanent-freeze-2026-09-11): ops-watch's last success was
// run 34443764295 (dispatch, 2026-09-10T06:06Z) and every run after it failed.
// Run 34546423386 (schedule, 00:25Z) listed EIGHT problems: four duties STALE
// only because they were read off the WHOLE-RUN conclusion of the last
// scheduled ops-watch success while the job or step performing each of them was
// green in every one of those runs; `duty.workflow.ops-watch.yml` itself, which
// needed a green ops-watch for ops-watch to go green; a laptop beat; and two
// genuinely red lanes, one of them (e2e.yml) NOT self-gated and so outside the
// exemption entirely. ci.yml runs this guard on every pull request, so the PRs
// fixing the two real bugs were blocked by main's history. The three rules
// below replace every special case, and the header at the top of this file
// states the six invariants they establish.
//
// ── THE RULE: NO HOST REQUIRES ITSELF (INV4) ────────────────────────────────
// A live verdict about a row may BLOCK in an enforcing host H only if that row's
// recovery does not need H to be green. "Needs" has two DERIVED edges:
//   · OWN HOST   — the row's unit contains this guard's own verdict inside H:
//                  the whole run of a guard host, a job that runs this guard, or
//                  a job or step that is SKIPPED when it fails. `checkRunUnits`
//                  refuses such a unit in the register; the edge stays so a
//                  register that slips past can still never freeze.
//   · SELF-GATED — the row's workflow runs `assert-gate-passed.mjs`, and H
//                  produces the check that script waits for.
// and one composed edge: an enforcing host blocks on every other red verdict.
// If H is reachable from the row, the verdict PRINTS in H, with the path, and
// blocks everywhere else. `SELF` was an OWN HOST edge, SELF-GATED is itself, and
// SECOND LAP was the path row → ops-watch.yml → a red self-gated lane → ci.yml.
//
// ── DERIVED, NEVER LISTED, AND NEVER FROM A CALLER'S FLAG ──────────────────
//   · SELF-GATED  — every workflow that RUNS tooling/ci/assert-gate-passed.mjs.
//   · GUARD HOSTS — every workflow that RUNS tooling/ci/assert-ops-register.mjs.
//   · THE GATE    — `const GATE` read out of assert-gate-passed.mjs, and the ONE
//                   workflow declaring a job by that name.
//   · THE HOST    — GITHUB_WORKFLOW_REF / GITHUB_WORKFLOW (`hostWorkflowFile`).
//   · THE EVENT   — GITHUB_EVENT_NAME, believed only when the host's own `on:`
//                   block declares it (`hostPolicy`).
// Never a `--allow-deadlock` argument and never a register field: a flag a
// caller may pass is a waiver, and a waiver is how this alarm gets switched off
// by the next person in a hurry.
//
// 🔴 FAIL-CLOSED IN EVERY DIRECTION. No topology, no gate name, no gate producer,
// two producers, an unresolvable host or an unparsed workflow — any one means NO
// exemption: every live verdict in an enforcing host BLOCKS, and the incomplete
// derivation is printed as a sentence on every run.
// ─────────────────────────────────────────────────────────────────────────────

/** The gate the deploy lanes wait on, and the guard whose exit code decides it.
 *  Both are FILES IN THIS TREE, read rather than described — a rename that is not
 *  followed here collapses the derivation to `null`, which restores blocking. */
export const GATE_SCRIPT_REL = 'tooling/ci/assert-gate-passed.mjs';
export const GUARD_SCRIPT_REL = 'tooling/ci/assert-ops-register.mjs';

/** PURE, over a workflow already parsed by the ONE parser. Does this file
 *  actually RUN `scriptRel`?
 *
 *  🔴 "MENTIONS" IS NOT "RUNS", AND THE DIFFERENCE IS A REAL LINE IN THIS TREE.
 *  `deploy-web.yml` names `tooling/ci/assert-gate-passed.mjs` inside its
 *  `on.push.paths:` filter — a substring search would read that as an invocation,
 *  which is harmless there but is exactly the sloppiness that later admits a
 *  workflow to a deadlock exemption on the strength of a comment. So a segment
 *  must invoke `node` AND name the script. `parseWorkflow` has already blanked
 *  comments, which is the other half (`build-platforms.yml` names the script in
 *  one). */
export function workflowRunsScript(parsed, scriptRel) {
  const base = String(scriptRel).split('/').pop();
  for (const l of parsed?.lines ?? []) {
    for (const seg of shellSegments(String(l.text))) {
      if (/(^|\s)node(\s|$)/.test(seg) && seg.includes(base)) return true;
    }
  }
  return false;
}

/** IMPURE. The check-run name `assert-gate-passed.mjs` waits for, read out of
 *  that script's own source so the two cannot drift. `null` when the file is
 *  gone or the constant has moved — and `null` exempts nothing.
 *
 *  ⚠️ A DEBT, NAMED RATHER THAN HIDDEN: this is the THIRD reader of
 *  `const GATE` in `tooling/ci`. `assert-release-lane-generic.mjs` (~line 406)
 *  and `assert-release-provenance.mjs` (~line 524) each carry their own copy of
 *  this regex AND their own "which workflow declares a job by that name" walk.
 *  `grep-10` says the answer is one reader in `workflow-scan.mjs`, not a third
 *  copy here — and that is owed. It is not taken in this change because the
 *  consolidation has to move two other guards, their two test files and their
 *  two coverage-manifest keys, none of which this branch owns, and shipping a
 *  livelock fix behind a four-file refactor is the wrong trade while `main` is
 *  frozen.
 *
 *  What keeps the debt cheap in the meantime is the DIRECTION each copy fails
 *  in. Rename the constant and the other two stop with COVERAGE LOST; this one
 *  returns `null`, which exempts nothing and restores blocking. Three readers
 *  that drift, all three toward refusing rather than toward passing. */
export function gateCheckName(root) {
  const abs = join(root, GATE_SCRIPT_REL);
  if (!existsSync(abs)) return null;
  const m = /^const GATE = ['"]([^'"]+)['"];/m.exec(readFileSync(abs, 'utf8'));
  return m ? m[1] : null;
}

/** IMPURE, and the ONE impure input to the deadlock rule. Returns
 *  `{ selfGated, guardHosts, gateName, gateWorkflow, why }` — three derivations
 *  over the workflow tree plus the reason any of them came back empty, so a
 *  collapsed derivation is a printed sentence rather than a quietly restored
 *  freeze. */
export function gateTopology(root) {
  const parsed = parseAllWorkflows(root);
  const fileOf = (wf) => String(wf?.rel ?? '').split('/').pop();
  const selfGated = new Set();
  const guardHosts = new Set();
  for (const wf of parsed) {
    if (workflowRunsScript(wf, GATE_SCRIPT_REL)) selfGated.add(fileOf(wf));
    if (workflowRunsScript(wf, GUARD_SCRIPT_REL)) guardHosts.add(fileOf(wf));
  }
  const why = [];
  const gateName = gateCheckName(root);
  if (!gateName) why.push(`no \`const GATE = …\` could be read out of ${GATE_SCRIPT_REL}, so the gate has no name here`);
  if (selfGated.size === 0) why.push(`no workflow under ${WORKFLOW_DIR_REL} runs ${GATE_SCRIPT_REL}, so no lane is self-gated`);
  if (guardHosts.size === 0) why.push(`no workflow under ${WORKFLOW_DIR_REL} runs ${GUARD_SCRIPT_REL}, so no workflow's conclusion is produced by this guard`);
  // 🔴 EXACTLY ONE producer, or none. Two jobs answering to the gate's name
  // would make "which host feeds the gate" a guess, and a guess here is a
  // silently widened exemption.
  const producers = new Set();
  if (gateName) {
    for (const wf of parsed) {
      for (const job of wf.jobs?.values?.() ?? []) {
        if (job?.displayName === gateName || job?.name === gateName) producers.add(fileOf(wf));
      }
    }
  }
  let gateWorkflow = null;
  if (producers.size === 1) [gateWorkflow] = producers;
  else if (gateName && producers.size === 0) why.push(`no workflow declares a job named \`${gateName}\`, so the gate-producing workflow is unknown`);
  else if (producers.size > 1) why.push(`${producers.size} workflows declare a job named \`${gateName}\` (${[...producers].join(' · ')}), so which host feeds the gate would be a guess`);
  return { selfGated, guardHosts, gateName, gateWorkflow, why };
}

/** PURE. Is THIS run the one whose exit code decides the gate? Both halves are
 *  required: the host must be the gate-producing workflow AND must actually run
 *  this guard. `hostWorkflow` comes from `hostWorkflowFile()`, i.e. from the
 *  environment — never from an argument a caller chooses. */
export function feedsTheGate(hostWorkflow, topology) {
  return Boolean(
    topology?.gateWorkflow && hostWorkflow && topology.gateWorkflow === hostWorkflow && topology.guardHosts.has(hostWorkflow),
  );
}

/** PURE. The job id of the gate aggregator inside `wf`, or null — null unless
 *  `wf` IS `topology.gateWorkflow` and exactly one of its jobs answers to
 *  `topology.gateName`. ⏱ 2026-09-25 [ADR 095 §4]. */
export function gateJobOf(wf, topology) {
  if (!wf || !topology?.gateWorkflow || !nonEmpty(topology?.gateName)) return null;
  if (String(wf.rel ?? '').split('/').pop() !== topology.gateWorkflow) return null;
  const hits = [...(wf.jobs?.entries?.() ?? [])]
    .filter(([id, j]) => j?.displayName === topology.gateName || id === topology.gateName)
    .map(([id]) => id);
  return hits.length === 1 ? hits[0] : null;
}

/** PURE. ⏱ 2026-09-25 [ADR 095 §4] The post-gate jobs of the gate workflow —
 *  `needs:` the aggregator and `if:` byte-equal to `POST_GATE_IF`, through the
 *  one definition in workflow-scan.mjs that assert-green-means-ran's A9 also asks
 *  — as `{ gateWorkflow, gateJob, jobs: Set<id> }`, or null when the topology
 *  names no gate job. A post-gate job cannot redden its own run's gate, and its
 *  red routes OWN HOST (prints in the gate workflow, blocks elsewhere), which is
 *  why a trigger row judged by post-gate jobs alone is admitted to RED SINCE with
 *  no `workflow_dispatch`: a red one never has to merge through itself. */
export function postGateAdmission(parsedByFile, topology) {
  const file = topology?.gateWorkflow ?? null;
  const wf = file ? (parsedByFile?.get?.(file) ?? null) : null;
  const gateJob = gateJobOf(wf, topology);
  if (!gateJob) return null;
  return { gateWorkflow: file, gateJob, jobs: new Set(postGateJobs(wf, gateJob)) };
}

/** PURE. How `postGate` reads one row's query: null when the row does not read
 *  the gate workflow; `{ ok: true }` when its unit is post-gate jobs only;
 *  `{ ok: false, off }` naming the unit's jobs that are not. */
export function postGateUnit(q, postGate) {
  if (!(postGate?.jobs instanceof Set) || String(q?.workflow ?? '') !== postGate.gateWorkflow) return null;
  const u = unitOf(q);
  if (u.kind !== 'jobs' || u.jobs.length === 0) return { ok: false, off: [describeUnit(q)] };
  const off = u.jobs.filter((j) => !postGate.jobs.has(j));
  return off.length ? { ok: false, off } : { ok: true };
}

/** The events on which a guard host judges a PROPOSED change rather than the
 *  default branch itself. INV1 is about exactly these: a verdict read off main's
 *  history is not a property of the proposal, and the proposal is how it gets
 *  fixed. GitHub's own vocabulary, not a list this file can grow to silence
 *  something — and `hostPolicy` still refuses the event unless the host workflow
 *  on disk declares it. */
export const PROPOSAL_EVENTS = new Set(['pull_request', 'pull_request_target', 'merge_group']);

/** `file -> Set<event>` for every workflow, through the one parser. */
export function workflowEventsByFile(parsedWorkflows) {
  const out = new Map();
  for (const wf of parsedWorkflows ?? []) out.set(String(wf?.rel ?? '').split('/').pop(), workflowEvents(wf));
  return out;
}

/** PURE. INV1 + INV2 + INV5: may a LIVE verdict block in THIS run? Returns
 *  `{ host, event, mode: 'advisory' | 'enforcing', why }`.
 *
 *  ADVISORY only when all four hold, each derived rather than declared: the run
 *  is inside a GitHub Actions job whose workflow FILE resolves; the event is a
 *  proposal event; that workflow runs this guard; and its own `on:` block
 *  declares that event. Anything else — off Actions, an unnamed event, a push, a
 *  schedule, a dispatch, a host that does not run this guard, an event its file
 *  does not declare — is ENFORCING, which is the pre-2026-09-11 behaviour. The
 *  failure to prove "this is a proposal" never lifts a block. */
export function hostPolicy(env, topology, eventsByFile) {
  const host = hostWorkflowFile(env);
  const event = nonEmpty(env?.GITHUB_EVENT_NAME) ? String(env.GITHUB_EVENT_NAME).trim() : null;
  const enforcing = (why) => ({ host, event, mode: 'enforcing', why });
  if (!host) {
    return enforcing(
      'no host workflow resolved (not inside a GitHub Actions job, or GITHUB_WORKFLOW_REF names no workflow file), ' +
        'so every live verdict BLOCKS, exactly as a local run always has',
    );
  }
  if (!event) return enforcing(`${host} with no GITHUB_EVENT_NAME — an event this guard cannot name is not a proposal it can believe, so every live verdict BLOCKS`);
  if (!PROPOSAL_EVENTS.has(event)) {
    if (feedsTheGate(host, topology)) {
      return enforcing(
        `${host} on \`${event}\` — this run's exit code decides \`${topology.gateName}\` for a commit on its own branch, ` +
          `and every self-gated lane (${[...topology.selfGated].sort().join(' · ')}) runs ${GATE_SCRIPT_REL} and ` +
          'refuses to ship that commit unless the check passed — so a live verdict BLOCKS here (INV2)',
      );
    }
    return enforcing(
      `${host} on \`${event}\` — this run judges the default branch itself` +
        `${topology?.guardHosts?.has(host) ? ' and its red conclusion is the page' : ''}, so a live verdict BLOCKS here`,
    );
  }
  if (!topology?.guardHosts?.has(host)) {
    return enforcing(`${host} on \`${event}\` — but by the workflow derivation ${host} does not run ${GUARD_SCRIPT_REL}, so this cannot be the proposal gate this guard feeds; fail-closed, every live verdict BLOCKS`);
  }
  if (!(eventsByFile?.get(host) instanceof Set) || !eventsByFile.get(host).has(event)) {
    return enforcing(
      `${host} on \`${event}\` — but ${WORKFLOW_DIR_REL}/${host} declares no \`${event}\` in its \`on:\` block, so the ` +
        'environment contradicts the file on disk and is not believed; fail-closed, every live verdict BLOCKS',
    );
  }
  return {
    host,
    event,
    mode: 'advisory',
    why:
      `${host} on \`${event}\` judges a PROPOSED CHANGE. A verdict read off the default branch's run history, a job ` +
      'conclusion, a heartbeat or a live monitor is not a property of that change, and a pull request is how such a ' +
      'verdict gets FIXED — so here every live verdict PRINTS in full, with its remedy, and does not block (INV1). ' +
      'The same verdict still BLOCKS on push to the default branch, whose `ci-gate` every deploy lane polls before ' +
      'it ships (INV2), and still fails ops-watch, which is the page. A structural problem with the register itself ' +
      'is a property of this change and still blocks here.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 · THE LIVE READS ARE NOT MADE WHERE THEIR VERDICT CANNOT BLOCK.
//
// 🔴 MEASURED the same day under a counting fetch preload: one run of this guard
// makes 56 GitHub API requests (55 core, 1 search), and it runs in every CI run.
// GITHUB_TOKEN is allowed 1,000 requests an hour per repository. 07:00–08:15Z
// spent about 2,225 — this guard about 1,600 of them — and every CI run started
// at 06:42Z and from 08:09Z to 08:15Z died on `API rate limit exceeded for
// installation`.
//
// On a pull_request host those requests could not do what they exist for:
// `hostPolicy` is ADVISORY there and `routeLiveVerdicts` prints every live verdict
// and blocks none (INV1). The one thing the reads could still do was exit 2 when
// the quota they had just spent refused them (INV6) — the red that froze every
// open pull request at once. So on that host the reads are not made, and one
// plain line says so. EVERY STRUCTURAL LIMB STILL RUNS: the register's shape,
// the reader declarations and their ceilings, the unit each duty is judged by,
// the redness domain and its census.
//
// THREE THINGS KEEP THIS FROM BECOMING A BLIND SPOT:
//   · a proposal that changes a file the reads are BUILT FROM (`liveReadInputs`)
//     makes every read, so a register, reader or workflow change is graded
//     against the live world before it merges, exactly as before;
//   · a changed-file set git cannot establish (`proposalChangedFiles`) makes
//     every read — unknown is never "nothing changed";
//   · an ENFORCING host never asks: push to main, ops-watch, a dispatch and a
//     local run make the reads unconditionally and spawn no git (INV2).
// ─────────────────────────────────────────────────────────────────────────────

/** Handed to both evaluators in place of a probe map when the reads were not
 *  made. Each still runs every structural check it owns and returns before it
 *  would classify an answer it does not have. */
export const LIVE_READS_NOT_MADE = Symbol.for('assert-ops-register.live-reads-not-made');

/** This guard's own checkout, where its imports live — not `ROOT`, which a test
 *  points at a fixture tree. */
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** PURE over `readSource(rel) → string`. Every repo-relative module `entryRel`
 *  pulls in through a RELATIVE specifier, itself included, transitively. `null`
 *  when any of them cannot be read: an unknown closure is not an empty one. A
 *  specifier written only in a comment is followed too; that can only ADD a
 *  file, which is the direction that makes a read. */
export function localImportClosure(entryRel, readSource) {
  const seen = new Set();
  const queue = [posix.normalize(String(entryRel))];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    let src;
    try {
      src = String(readSource(rel));
    } catch {
      return null;
    }
    for (const m of src.matchAll(/\b(?:from|import)\s*\(?\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g)) {
      queue.push(posix.normalize(posix.join(posix.dirname(rel), m[2])));
    }
  }
  return seen;
}

/** PURE. The files the live reads are BUILT FROM — what they ask, and how the
 *  answer is graded and routed — derived, never listed:
 *    · the register: every row, record query, reader declaration and ceiling;
 *    · this guard and every module it imports: the reads and the verdicts;
 *    · `assert-gate-passed.mjs`, whose `GATE` names the check the topology routes by;
 *    · every workflow file: the unit a duty is judged by (INV3), the
 *      `workflow_dispatch` half of the redness domain, the gate topology, and
 *      the host policy itself;
 *    · every wrangler config a record query names: the D1 database it reads.
 *  `null` when the import closure is unknown, and a null makes every read. */
export function liveReadInputs(reg, closure) {
  if (!(closure instanceof Set) || closure.size === 0) return null;
  const files = new Set([REGISTER_REL, GATE_SCRIPT_REL, ...closure]);
  for (const r of reg?.rows ?? []) {
    const q = r?.mechanism?.recordQuery;
    for (const w of [q?.wrangler, q?.timer?.wrangler]) {
      if (nonEmpty(w)) files.add(posix.normalize(String(w)));
    }
  }
  return { files, prefixes: [`${WORKFLOW_DIR_REL}/`] };
}

/** IMPURE SHELL over an injected `git(args) → { status, stdout }`: the files a
 *  pull request changes, from git alone — no API request.
 *
 *  On `pull_request`, actions/checkout checks out `refs/pull/N/merge`, the
 *  two-parent commit GitHub built (`Merge <head> into <base>`, first parent the
 *  base), and with `fetch-depth: 0` it fetches every branch into
 *  `refs/remotes/origin/*` — both OBSERVED in the checkout step of CI run
 *  34577566209, job "Guards — platform, data and ops". The proposal's changes
 *  are then `diff <first parent> HEAD`, and they are believed only when every
 *  link holds: the base branch is named (GITHUB_BASE_REF); HEAD is the commit
 *  this run was started for (GITHUB_SHA); HEAD has exactly two parents; and the
 *  first parent is on `origin/<base>`. Anything else is `known: false`. */
export function proposalChangedFiles(env, git) {
  const unknown = (why) => ({ known: false, why });
  const exited = (r) => (Number.isInteger(r?.status) ? String(r.status) : 'without a status');
  const base = String(env?.GITHUB_BASE_REF ?? '').trim();
  if (!base) return unknown('GITHUB_BASE_REF is not set, so this run names no base branch to diff against');
  if (!/^[A-Za-z0-9._/-]+$/.test(base) || base.includes('..') || base.startsWith('-')) {
    return unknown(`GITHUB_BASE_REF ${JSON.stringify(base)} is not a branch name this guard will hand to git`);
  }
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']);
  if (parents?.status !== 0) return unknown(`\`git rev-list --parents -n 1 HEAD\` exited ${exited(parents)}`);
  const shas = String(parents.stdout ?? '').trim().split(/\s+/).filter(Boolean);
  const [head, first] = shas;
  const want = String(env?.GITHUB_SHA ?? '').trim();
  if (!want || want !== head) {
    return unknown(`HEAD ${String(head ?? 'none').slice(0, 8)} is not GITHUB_SHA ${want ? want.slice(0, 8) : '(unset)'}, the commit this run was started for`);
  }
  if (shas.length !== 3) {
    return unknown(`HEAD has ${shas.length - 1} parent(s), not the two of the merge commit actions/checkout makes for a pull request`);
  }
  // Exit 1 is "not an ancestor"; 128 is "that object or ref is not in this clone".
  // Both are UNKNOWN, and neither may be read as the other.
  const onBase = git(['merge-base', '--is-ancestor', first, `refs/remotes/origin/${base}`]);
  if (onBase?.status !== 0) {
    return unknown(`HEAD's first parent ${first.slice(0, 8)} is not shown to be on origin/${base} (\`git merge-base --is-ancestor\` exited ${exited(onBase)})`);
  }
  const diff = git(['diff', '--name-only', '--no-renames', '-z', first, head]);
  if (diff?.status !== 0) return unknown(`\`git diff --name-only ${first.slice(0, 8)} ${head.slice(0, 8)}\` exited ${exited(diff)}`);
  return { known: true, base, head, first, files: String(diff.stdout ?? '').split('\0').filter(Boolean) };
}

/** PURE. Does this run make the live reads, and the one line it prints about it.
 *  An ENFORCING host always reads and its `line` is null, so its output is
 *  unchanged. An ADVISORY host skips ONLY on a `pull_request` whose changed files
 *  are known and touch none of the inputs; every other answer makes the reads. */
export function liveReadPlan(policy, changed, inputs) {
  if (policy?.mode !== 'advisory') return { read: true, line: null, touched: [] };
  const made = (why) => ({ read: true, line: `[LIVE] reads made on this host: ${why}`, touched: [] });
  if (policy.event !== 'pull_request') {
    return made(`\`${policy.event}\` is not \`pull_request\`, whose merge commit is the only proposal this guard can diff with git, so the reads are made (fail-safe)`);
  }
  if (!changed?.known) return made(`which files this change touches could not be established (${changed?.why ?? 'no answer'}), so the reads are made (fail-safe)`);
  if (!inputs) return made('the files the live reads are built from could not be derived, so the reads are made (fail-safe)');
  const touched = (changed.files ?? []).filter((f) => inputs.files.has(f) || inputs.prefixes.some((p) => f.startsWith(p)));
  if (touched.length) {
    return {
      read: true,
      touched,
      line:
        `[LIVE] reads made on this host: this change touches ${touched.length} file(s) the live reads are built from ` +
        `(${touched.slice(0, 6).join(' · ')}${touched.length > 6 ? ' · …' : ''}), so it is graded against the live world before it merges`,
    };
  }
  return {
    read: false,
    touched,
    line:
      '[LIVE] NOT READ ON THIS HOST — no GitHub, GlitchTip or Cloudflare request was made. On a pull request a live ' +
      'verdict cannot block (INV1), and this change touches none of the files the live reads are built from ' +
      `(${inputs.files.size} named files, and everything under ${inputs.prefixes.join(' · ')}). ` +
      `The push run on ${changed.base} makes every one of them and enforces its verdict (INV2).`,
  };
}

/** `git -C root …`, bounded, for `proposalChangedFiles`. A timeout or an
 *  oversized answer comes back without a status, which is unknown. */
const gitIn = (root) => (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });

/** A condition under which a job or step still RUNS after something it follows
 *  failed. Without one, a failure ahead of it SKIPS it. */
export const RUNS_AFTER_FAILURE = /\balways\(\s*\)|\bfailure\(\s*\)|!\s*cancelled\(\s*\)/;

const unquote = (s) => String(s).replace(/^(['"])(.*)\1$/, '$2');

/** A step that runs a READER: `node tooling/….mjs`, in an inline `run:` or a
 *  block one. Comments are already blank, so a commented-out call reads nothing. */
const READER_CALL = /\bnode\s+(tooling\/[\w./-]+\.mjs)\b/g;

/** PURE, over a job the one parser produced.
 *  `[{ name, cond, id, index, n, reads, runsGuard }]` — `n` is the step's first
 *  line, `reads` the reader scripts it runs (empty for a `uses:` step or a step
 *  that runs none). Step items sit at six spaces (`      - `) and their keys at
 *  eight; `parseWorkflow` has already blanked comments. A step with no `name:`
 *  has no name a unit can cite, and says so by being `null`. */
export function jobSteps(job) {
  const steps = [];
  let cur = null;
  const field = (k) => (k === 'if' ? 'cond' : k);
  for (const l of job?.lines ?? []) {
    const text = String(l?.text ?? '');
    const start = /^ {6}- (.*)$/.exec(text);
    if (start) {
      cur = { name: null, cond: null, id: null, lines: [], index: steps.length };
      steps.push(cur);
      const inline = /^(name|if|id):\s*(\S.*?)\s*$/.exec(start[1]);
      if (inline) cur[field(inline[1])] = unquote(inline[2]);
      cur.lines.push({ n: l.n, text: `        ${start[1]}` });
      continue;
    }
    if (!cur) continue;
    if (text.trim() !== '' && /^ {0,5}\S/.test(text)) { cur = null; continue; }
    const key = /^ {8}(name|if|id):\s*(\S.*?)\s*$/.exec(text);
    if (key) cur[field(key[1])] = unquote(key[2]);
    cur.lines.push(l);
  }
  return steps.map(({ lines, ...s }) => ({
    ...s,
    n: lines[0]?.n ?? null,
    reads: [...new Set([...lines.map((l) => String(l?.text ?? '')).join('\n').matchAll(READER_CALL)].map((m) => m[1]))],
    runsGuard: workflowRunsScript({ lines }, GUARD_SCRIPT_REL),
  }));
}

// ── ⏱ 2026-09-23 · ONE READER'S RED MAY NEVER SILENCE ANOTHER ───────────────
// O-OPS-WATCH-HEARTBEAT-READER-SKIPPED. ops-watch.yml's heartbeats job runs
// THIS guard first and `check-heartbeats.mjs` second, and the second step
// carried no `if:`. A step with no condition runs only when every step above it
// succeeded, so every red register run SKIPPED the heartbeat read: 18 ops-watch
// runs measured that way between 2026-09-21T14:24Z and 2026-09-23, the latest
// 35843108090 (step 4, the register: failure; step 5: skipped). Its two
// siblings in the same job already carried `!cancelled()`. One line was
// missing, and nothing in the tree could say so.
//
// THE RULE, over every job of READER_WORKFLOW — each of which is GRADED, because
// `checkRunUnits` refuses a job there that is the unit of no duty row: every
// step that runs a reader (`node tooling/….mjs`) AFTER the job's first reader
// carries a condition under which it runs whatever the readers above it
// concluded — `!cancelled()`, or `always()` — or names, in its own condition,
// the earlier step it genuinely needs, as `steps.<id>.…` of a step above it in
// the same job. The first reader needs nothing: only setup precedes it.
//
// ⚠️ A dependency written as a COMMENT was the other shape considered, and it is
// not accepted: `parseWorkflow` blanks comments (one read of a workflow, one
// reduction — workflow-scan.mjs's header), so a comment is a claim no guard can
// check, while `steps.<id>` is a reference GitHub itself evaluates and this
// check can resolve.
//
// ⚠️ `failure()` ALONE IS REFUSED, although RUNS_AFTER_FAILURE accepts it for a
// job edge: on a reader it inverts the defect, skipping the read on every GREEN
// run instead of every red one.
//
// FLOOR. A READER_WORKFLOW in which no job holds two reader steps makes this
// range over nothing — READER_CALL stopped matching, or the jobs were split —
// and that is COVERAGE LOST, never a clean pass. An ABSENT READER_WORKFLOW is
// not decided here: every row anchored at it already goes COVERAGE LOST in
// `main`, and a fixture tree without it has no reader to judge.
//
// LANE-BOUND: ops-watch.yml — it is the one workflow the register grades job by job and step by step (measured 2026-09-23: every other run-history row's unit is the whole run), and each of its readers is an independent look at the world; in a build or deploy lane a step after a failure is MEANT to be skipped.
// The generic form, derived rather than named, is "every workflow some duty row
// judges by a `{ jobs }` or `{ job, step }` unit"; it is not built here because
// today that set is this one file, and a fixture register with no such row must
// render no verdict rather than COVERAGE LOST.
export const READER_WORKFLOW = 'ops-watch.yml';

/** Runs whatever an earlier step concluded (a cancel aside, for `!cancelled()`). */
export const RUNS_REGARDLESS = /\balways\(\s*\)|!\s*cancelled\(\s*\)/;

/** PURE, over the parsed READER_WORKFLOW (or `null`).
 *  `{ errors, prints, lost }` — `lost` is COVERAGE LOST's lines, or `null`. */
export function checkReaderIndependence(wf) {
  const errors = [];
  const prints = [];
  if (!wf) return { errors, prints, lost: null };
  const rel = wf.rel ?? `.github/workflows/${READER_WORKFLOW}`;
  let checked = 0;
  const graded = [];
  for (const [jobId, job] of wf.jobs ?? []) {
    const steps = jobSteps(job);
    const readers = steps.filter((s) => s.reads.length > 0);
    if (readers.length < 2) continue;
    graded.push(jobId);
    const first = readers[0];
    const firstLabel = first.name ? `"${first.name}"` : `#${first.index + 1}`;
    for (const s of readers.slice(1)) {
      checked += 1;
      const cond = String(s.cond ?? '');
      if (RUNS_REGARDLESS.test(cond)) continue;
      const above = new Set(steps.slice(0, s.index).map((p) => p.id).filter(Boolean));
      const named = [...cond.matchAll(/\bsteps\.([A-Za-z_][A-Za-z0-9_-]*)\./g)].map((m) => m[1]);
      const unresolved = named.filter((id) => !above.has(id));
      if (named.length > 0 && unresolved.length === 0) continue;
      const label = s.name ? `step "${s.name}"` : `step #${s.index + 1}`;
      const carries =
        s.cond == null
          ? 'carries no `if:`'
          : unresolved.length > 0
            ? `carries \`if: ${s.cond}\`, which names ${unresolved.map((id) => `steps.${id}`).join(' · ')} — no step above it in this job has that \`id:\``
            : `carries \`if: ${s.cond}\`, which is neither \`!cancelled()\`/\`always()\` nor a named dependency`;
      errors.push(
        `${rel}:${s.n} — job ${jobId}, ${label} runs ${s.reads.join(' · ')} after the reader step ${firstLabel} and ${carries}. ` +
          "GitHub SKIPS it whenever a step above it fails, so one reader's red silences another " +
          '(O-OPS-WATCH-HEARTBEAT-READER-SKIPPED: the heartbeat read was skipped in 18 runs this way). ' +
          "Give it `if: ${{ !cancelled() }}`; if it genuinely needs an earlier step's result, give that step an `id:` " +
          'and name it in this condition as `steps.<id>.outcome`.',
      );
    }
  }
  if (checked === 0) {
    return {
      errors,
      prints,
      lost: [
        `${rel} parsed to no job with two reader steps, so "one reader's red never silences another" ranged over nothing.`,
        `Its heartbeats job alone runs several. Either READER_CALL (\`node tooling/….mjs\`) stopped matching how the`,
        'steps call their readers, or the jobs were restructured; either way this check would print ok about nothing.',
      ],
    };
  }
  // The census never says "each" about a set it just refused part of.
  prints.push(
    `[READERS] ${READER_WORKFLOW} — ${checked} reader step(s) after the first, in ${graded.length} job(s) ` +
      `(${graded.join(' · ')}), ` +
      (errors.length === 0
        ? 'each running whatever the readers above it concluded'
        : `${errors.length} of them SKIPPED by any red step above (refused below)`),
  );
  return { errors, prints, lost: null };
}

/** PURE. Why this unit's conclusion CONTAINS this guard's own verdict inside its
 *  own workflow, or `null`. The whole run of a guard host does; so does the job
 *  that runs this guard; so does any job that `needs:` it, and any later step in
 *  its job, that carries no condition under which it still runs after a failure —
 *  because a guard that fails SKIPS those, and a skipped duty is not a green one.
 *
 *  ⏱ 2026-09-25 [ADR 095 §4] `topology` (optional) names the gate aggregator. A
 *  job whose `if:` is byte-equal to `POST_GATE_IF` and which needs that
 *  aggregator is walked THROUGH it: the aggregator RUNS after a failure (its own
 *  `always()`) but does not PASS after one, and the post-gate `if:` carries no
 *  status function, so GitHub's implicit `success()` skips the job. Without
 *  `topology` the walk stops at the aggregator, as it always did. */
export function unitNeedsGuard(wf, unit, topology = null) {
  if (!wf || !unit) return null;
  const guardJobs = [...(wf.jobs?.entries?.() ?? [])]
    .filter(([, j]) => workflowRunsScript({ lines: j.lines }, GUARD_SCRIPT_REL))
    .map(([id]) => id);
  if (guardJobs.length === 0) return null;
  if (unit.kind === 'run' || unit.kind === 'invalid') {
    return `the whole run includes job ${guardJobs.join(' · ')}, which runs ${GUARD_SCRIPT_REL}`;
  }
  const gateJob = gateJobOf(wf, topology);
  const jobNeeds = (id, seen = new Set(), through = false) => {
    if (seen.has(id)) return null;
    seen.add(id);
    const j = wf.jobs.get(id);
    if (!j) return null;
    if (guardJobs.includes(id)) return `job ${id} runs ${GUARD_SCRIPT_REL}`;
    if (!through && RUNS_AFTER_FAILURE.test(String(j.jobIf?.cond ?? ''))) return null;
    const post = j.jobIf?.cond === POST_GATE_IF;
    for (const dep of j.needs ?? []) {
      const via = post && gateJob !== null && dep === gateJob;
      const why = jobNeeds(dep, seen, via);
      if (why && via) return `job ${id} carries the post-gate \`if:\` and needs ${dep}, the gate aggregator, which RUNS after a failure but does not PASS after one — ${why}`;
      if (why && through) return `job ${id} needs ${dep} and concludes failure when it fails — ${why}`;
      if (why) return `job ${id} needs ${dep} with no always()/failure()/!cancelled() condition, so it is SKIPPED when that fails — ${why}`;
    }
    return null;
  };
  if (unit.kind === 'jobs') {
    for (const id of unit.jobs) {
      const why = jobNeeds(id);
      if (why) return why;
    }
    return null;
  }
  const job = wf.jobs.get(unit.job);
  if (!job) return null;
  const steps = jobSteps(job);
  const at = steps.findIndex((s) => s.name === unit.step);
  if (at === -1) return null;
  if (steps[at].runsGuard) return `step "${unit.step}" IS the step in job ${unit.job} that runs ${GUARD_SCRIPT_REL}`;
  const guardAt = steps.findIndex((s) => s.runsGuard);
  if (guardAt !== -1 && guardAt < at && !RUNS_AFTER_FAILURE.test(String(steps[at].cond ?? ''))) {
    return (
      `step "${unit.step}" follows the step running ${GUARD_SCRIPT_REL} in job ${unit.job} and carries no ` +
      'always()/failure()/!cancelled() condition, so it is SKIPPED whenever this guard fails'
    );
  }
  if (!RUNS_AFTER_FAILURE.test(String(job.jobIf?.cond ?? ''))) {
    for (const dep of job.needs ?? []) {
      const why = jobNeeds(dep);
      if (why) return `job ${unit.job} needs ${dep} with no always()/failure()/!cancelled() condition — ${why}`;
    }
  }
  return null;
}

/** PURE. The hosts this row's RECOVERY needs to be green: `[{ host, why }]`.
 *  Exactly the two derived edges in the header above — OWN HOST and SELF-GATED —
 *  and nothing a caller or a register field can add. An unparsed workflow adds
 *  no OWN HOST edge: fail-closed means blocking, never a guessed exemption. */
export function unitNeedsHosts(row, topology, parsedByFile) {
  const q = row?.mechanism?.recordQuery;
  const file = nonEmpty(q?.workflow) ? String(q.workflow) : null;
  const out = [];
  if (!file || !topology) return out;
  if (topology.guardHosts?.has(file)) {
    const why = unitNeedsGuard(parsedByFile?.get(file) ?? null, unitOf(q), topology);
    if (why) {
      out.push({
        host: file,
        why:
          `OWN HOST — ${row.id} is judged by ${describeUnit(q)}, and ${why}; blocking this verdict inside ${file} ` +
          `would make ${file} unable to go green until ${file} is green (INV4)`,
      });
    }
  }
  if (topology.selfGated?.has(file) && topology.gateWorkflow) {
    out.push({
      host: topology.gateWorkflow,
      why:
        `SELF-GATED — ${WORKFLOW_DIR_REL}/${file} runs ${GATE_SCRIPT_REL}, which refuses while \`${topology.gateName}\` ` +
        `is red, and ${topology.gateWorkflow} produces \`${topology.gateName}\`; the dispatch that would clear this verdict ` +
        'aborts on the red this verdict would produce. Its remedy is UNREACHABLE from that host',
    });
  }
  return out;
}

/** PURE. The ONE router for every live verdict, from both limbs. `live` is
 *  `[{ id, line, code: 1 | 2 }]`; returns `{ blocking, printed, notes }`, where a
 *  printed entry carries `why`. Nothing here can turn a verdict into a pass: it
 *  decides only whether THIS host's exit code carries it.
 *
 *  · ADVISORY host (INV1) — everything prints.
 *  · ENFORCING host — a verdict blocks unless this host is REACHABLE from its row
 *    over the needs-graph (INV4). The composed edge "an enforcing host blocks on
 *    every other red verdict" is taken in full, which can only ever exempt MORE
 *    than an exact fixed point would; the only edges that can start such a path
 *    are OWN HOST (refused in the register by `checkRunUnits`, so it exists only
 *    on a register that already fails structurally, in every host) and SELF-GATED.
 *  · Incomplete topology or no host — nothing is exempt. */
export function routeLiveVerdicts(live, policy, topology, reg, parsedByFile) {
  const blocking = [];
  const printed = [];
  const notes = [];
  const verdicts = live ?? [];
  if (policy?.mode === 'advisory') {
    for (const v of verdicts) printed.push({ ...v, why: 'ADVISORY on a proposal event (INV1) — see HOST POLICY above; it BLOCKS on push to the default branch and in ops-watch' });
    return { blocking, printed, notes };
  }
  const incomplete = !topology || (topology.why ?? []).length > 0;
  const host = policy?.host ?? null;
  if (incomplete || !host) {
    blocking.push(...verdicts);
    if (incomplete && verdicts.length) {
      notes.push('[INV4] 🔴 NO LIVE VERDICT WAS EXEMPTED: the gate topology is incomplete (printed above), and an exemption is granted only on proof, never on a missing answer.');
    }
    return { blocking, printed, notes };
  }
  const rows = new Map((reg?.rows ?? []).map((r) => [r.id, r]));
  // ⏱ 2026-09-18 — page-only rows (checkLiveVerdictScopes). Structure is refused
  // in every host by that check, so here only a well-formed scope is honoured.
  const scoped = [];
  const rest = [];
  for (const v of verdicts) {
    const sc = rows.get(v.id)?.liveVerdictScope;
    const ok = String(v.id).startsWith('duty.laptop.') && sc?.blocks === 'page-only' && topology.guardHosts?.has(sc?.page);
    if (ok && sc.page !== host) scoped.push(v);
    else rest.push(v);
  }
  for (const v of scoped) {
    printed.push({ ...v, why: `PAGE-ONLY (owner, 2026-09-18) — ${v.id} blocks only in ${rows.get(v.id).liveVerdictScope.page}; in ${host} it PRINTS.` });
  }
  return routeRest(rest);
  function routeRest(verdictsLeft) {
  const redIds = [...new Set(verdictsLeft.map((v) => v.id))];
  const needs = new Map(redIds.map((id) => [id, unitNeedsHosts(rows.get(id), topology, parsedByFile)]));
  const enforcingHosts = new Set(topology.guardHosts ?? []);
  const pathTo = (start) => {
    const seen = new Set([start]);
    const queue = [[start, []]];
    while (queue.length) {
      const [id, trail] = queue.shift();
      for (const n of needs.get(id) ?? []) {
        const step = [...trail, `${id} needs ${n.host}: ${n.why}`];
        if (n.host === host) return step;
        if (!enforcingHosts.has(n.host)) continue;
        for (const other of redIds) {
          if (seen.has(other)) continue;
          seen.add(other);
          queue.push([other, [...step, `${n.host} blocks on ${other}, which is red`]]);
        }
      }
    }
    return null;
  };
  for (const v of verdictsLeft) {
    const path = pathTo(v.id);
    if (!path) blocking.push(v);
    else printed.push({ ...v, why: path.length === 1 ? path[0] : `CYCLE of ${path.length} edges back to ${host} — ${path.join(' ⇒ ')}` });
  }
  return { blocking, printed, notes };
  }
}

/** The rows this limb grades. TWO admissions, and they are graded for the SAME
 *  thing — REDNESS — by the same clockless comparison:
 *
 *    1. a `duty.workflow.*` row ON A CLOCK whose record is the run history of a
 *       named workflow on a named branch. Unchanged since 2026-09-07.
 *    2. ⏱ 2026-09-09 — a `duty.workflow.*` row on `cadence: trigger` with the
 *       same shape of record, WHOSE WORKFLOW FILE DECLARES `workflow_dispatch`.
 *       That declaration is the whole admission test: it is what makes the
 *       freeze this limb can impose bounded, because one dispatched green run
 *       clears it with no merge. See the header block, ⏱ 2026-09-09.
 *
 *  DERIVED from the register and from the workflow files, never listed — a
 *  hand-kept list of watched workflows is the drift this whole file exists to
 *  refuse, and a list would also have to be edited (i.e. could be shortened) to
 *  close the alarm. `dispatchable` is that derivation, computed once by
 *  `dispatchableWorkflows` and handed in so this function stays PURE.
 *
 *  🔴 IT FAILS CLOSED ON A MISSING DERIVATION. `dispatchable = null` — a caller
 *  with no workflow tree to read — admits NO trigger row, which is exactly the
 *  pre-2026-09-09 domain. Never a guess: a row is admitted to a BLOCKING alarm
 *  only on evidence that its remedy is reachable. The silence that direction
 *  costs is answered by `redSinceTriggerCensus`, which names every unadmitted
 *  trigger row and its reason on every run. */
export function redSinceDomain(reg, dispatchable = null, postGate = null) {
  return (reg?.rows ?? []).filter((r) => {
    if (r?.kind !== 'duty' || !String(r?.id ?? '').startsWith('duty.workflow.')) return false;
    const q = r?.mechanism?.recordQuery;
    if (!(q?.reader === 'github-run-history' && nonEmpty(q?.workflow) && nonEmpty(q?.headBranch))) return false;
    const cadence = String(r?.cadence ?? '');
    if (TIME_CADENCE.test(cadence)) return true;
    if (cadence !== 'trigger') return false;
    // ⏱ 2026-09-25 [ADR 095 §4] Or a trigger row whose unit is post-gate jobs of
    // the gate workflow ONLY (`postGateAdmission`, handed in like `dispatchable`):
    // those jobs run after the gate passed, so their red never blocks their own merge.
    if (postGateUnit(q, postGate)?.ok) return true;
    return dispatchable instanceof Set && dispatchable.has(String(q.workflow));
  });
}

/** PURE. Every `duty.workflow.*` row on `cadence: trigger`, split into the ones
 *  this limb admitted and the ones it did not — each of the latter carrying the
 *  DERIVED reason. ⏱ 2026-09-09.
 *
 *  🔴 THIS IS THE ANTI-SHRINK HALF AND IT IS NOT DECORATION. The admission above
 *  is derived from a file on disk, so deleting `workflow_dispatch:` from
 *  `deploy-web.yml` would quietly take that row out of a blocking alarm — the
 *  same shape as shortening a list, arrived at from the other side. Printing the
 *  exclusions with their reasons on EVERY run means that shrink is a sentence in
 *  the log rather than a number that got smaller. */
export function redSinceTriggerCensus(reg, dispatchable = null, postGate = null) {
  const admitted = [];
  const excluded = [];
  // ⏱ 2026-09-25 [ADR 095 §4] Why each admitted row is in: 'workflow_dispatch' or
  // 'post-gate'. Two admissions, printed apart, so losing one is visible on its own.
  const admittedBy = {};
  for (const r of reg?.rows ?? []) {
    if (r?.kind !== 'duty' || !String(r?.id ?? '').startsWith('duty.workflow.')) continue;
    if (String(r?.cadence ?? '') !== 'trigger') continue;
    const file = rowWorkflowFile(r);
    const q = r?.mechanism?.recordQuery;
    const hasQuery = q?.reader === 'github-run-history' && nonEmpty(q?.workflow) && nonEmpty(q?.headBranch);
    const pg = hasQuery ? postGateUnit(q, postGate) : null;
    if (pg?.ok) {
      admitted.push(r.id);
      admittedBy[r.id] = 'post-gate';
      continue;
    }
    if (!(dispatchable instanceof Set)) {
      excluded.push(
        `${r.id} — no workflow-dispatch derivation was supplied on this run, so NO trigger row was admitted. ` +
          'This limb refuses to guess that a red lane has a non-merge exit; the caller must read the workflow ' +
          'files (`dispatchableWorkflows`) and hand the answer in.',
      );
      continue;
    }
    if (file === null) {
      excluded.push(`${r.id} — neither a \`recordQuery.workflow\` nor a \`${WORKFLOW_DIR_REL}/…\` anchor names a workflow file, so nothing on disk could be read for a \`workflow_dispatch\` trigger.`);
      continue;
    }
    if (pg && !dispatchable.has(file)) {
      excluded.push(
        `${r.id} — reads \`${WORKFLOW_DIR_REL}/${file}\`, the gate workflow, and job(s) ${pg.off.join(' · ')} of its unit ` +
          `are not post-gate (\`needs: [${postGate.gateJob}]\` and \`if: ${POST_GATE_IF}\`, byte-equal). A unit that can ` +
          'redden its own gate can be made green only by MERGING, so it is not graded. Excluded by DERIVATION from ' +
          'the workflow file.',
      );
      continue;
    }
    if (!dispatchable.has(file)) {
      excluded.push(
        `${r.id} — \`${WORKFLOW_DIR_REL}/${file}\` declares NO \`workflow_dispatch\`, so its newest run on its own ` +
          'branch can be made green only by MERGING. Grading it would block merges on a state only a merge can ' +
          'clear — the `ci-18` deadlock this repository has already paid ~46h of frozen queue for. Excluded by ' +
          'DERIVATION from the workflow file, not by being left off a list.',
      );
      continue;
    }
    if (!hasQuery) {
      excluded.push(
        `${r.id} — \`${WORKFLOW_DIR_REL}/${file}\` DOES declare \`workflow_dispatch\`, so a red run there has an ` +
          'exit that is not a merge and this row COULD be graded — but it carries no ' +
          '`mechanism.recordQuery` naming a `github-run-history` reader, a `workflow` and a `headBranch`, so ' +
          'there is nothing to read. Give it one, or this lane going red is watched by nobody.',
      );
      continue;
    }
    admitted.push(r.id);
    admittedBy[r.id] = 'workflow_dispatch';
  }
  return { admitted, excluded, admittedBy };
}

/** PURE. The shape a `trigger` row's `recordQuery` must have, and the split it
 *  must not blur. ⏱ 2026-09-09.
 *
 *  These rows are OUTSIDE `evaluateRunRecords` — that limb ranges over
 *  `TIME_CADENCE` rows and always will — so every rule it applies to a
 *  `github-run-history` read would go unapplied here unless it is stated. Two of
 *  them matter and both are carried over rather than weakened:
 *
 *    · `headBranch` is REQUIRED. A run-history read is a claim about a BRANCH as
 *      well as an outcome, and the redness comparison reads both halves at
 *      branch width.
 *    · `event` may NEVER name `workflow_dispatch`. The redness probe drops the
 *      event filter on both halves, so the field decides nothing here — but the
 *      register would then be carrying the sentence "a hand-press is this row's
 *      evidence", and a later cadence flip would move that sentence into the
 *      freshness limb where it decides everything. Refused at both ends.
 *
 *  🔴 AND THE CLOCK FIELDS ARE REFUSED OUTRIGHT. `missedRunsTolerated`,
 *  `firstDue` and `timer` are all arithmetic over `cadenceDays()`, which returns
 *  `null` for `trigger`. On a clockless row they would be either inert (a
 *  guarantee the row does not make) or, worse, read by a limb that later widens
 *  its domain. What is graded here is REDNESS, never STALENESS; refusing the
 *  staleness vocabulary is how that stays true without depending on anybody
 *  remembering it. */
export function redSinceTriggerShape(reg) {
  const errors = [];
  for (const r of reg?.rows ?? []) {
    if (r?.kind !== 'duty' || !String(r?.id ?? '').startsWith('duty.workflow.')) continue;
    if (String(r?.cadence ?? '') !== 'trigger') continue;
    const q = r?.mechanism?.recordQuery;
    if (!q) continue; // a trigger row need not carry one; the census says so out loud.
    if (q.reader !== 'github-run-history') {
      errors.push(
        `${r.id} — \`cadence: trigger\` with \`recordQuery.reader: ${JSON.stringify(q.reader ?? null)}\`. The only ` +
          'record a clockless workflow duty has is its RUN HISTORY: there is no window for a heartbeat to be ' +
          'fresh inside, so no other reader could say anything about this row.',
      );
      continue;
    }
    if (!nonEmpty(q.workflow) || !nonEmpty(q.headBranch)) {
      errors.push(`${r.id} — \`cadence: trigger\` with a \`github-run-history\` read that names no \`workflow\` and/or no \`headBranch\`. The redness comparison orders two runs ON ONE BRANCH; without both it would have to guess which, and a guess here freezes the merge queue over a feature branch.`);
    }
    if (q.event !== undefined && String(q.event).includes('workflow_dispatch')) {
      errors.push(
        `${r.id} — \`recordQuery.event: ${JSON.stringify(q.event)}\`. The same refusal [14]O-3 makes on a ` +
          'scheduled row, made here so a trigger row cannot carry it in and then be flipped onto a clock: a ' +
          'dispatched run proves somebody pressed a button, and this register may not name that as a duty\'s evidence.',
      );
    }
    for (const field of ['missedRunsTolerated', 'missedRunsToleratedWhy', 'firstDue', 'firstDueWhy', 'timer']) {
      if (q[field] !== undefined) {
        errors.push(
          `${r.id} — \`recordQuery.${field}\` on a \`cadence: trigger\` row. That field is arithmetic over a ` +
            'CADENCE WINDOW and `cadenceDays("trigger")` is `null`, so nothing would apply it. This limb grades ' +
            'REDNESS — is the newest failure newer than the newest success — and never staleness; a clockless row ' +
            'may not carry the vocabulary of a clock.',
        );
      }
    }
  }
  return errors;
}

/** PURE. The workflow FILE this guard is currently executing inside, or `null`
 *  when it is not inside a GitHub Actions job — the single input to the `self`
 *  verdict added 2026-09-08 (see the header, TRAPS `ci-42`/`ci-43`).
 *
 *  `GITHUB_WORKFLOW_REF` is the authoritative one and it names the FILE:
 *  `owner/repo/.github/workflows/ops-watch.yml@refs/heads/main`.
 *  `GITHUB_WORKFLOW` is the workflow's `name:` — "Ops watch" here — EXCEPT when
 *  the workflow declares no name, in which case GitHub sets it to the file path.
 *  So the ref is read first and the name is accepted only when it is already a
 *  `.yml`/`.yaml` path.
 *
 *  🔴 IT RETURNS `null` RATHER THAN GUESSING. An unresolvable host means every
 *  row is graded exactly as before — the deadlock returns, loudly, instead of a
 *  row being silently deferred on a run that could not prove it was the host.
 *  Fail-closed is the only safe direction for a function whose output REMOVES a
 *  row from an alarm. */
export function hostWorkflowFile(env = process.env) {
  const inJob = nonEmpty(env?.GITHUB_WORKFLOW) || nonEmpty(env?.GITHUB_RUN_ID);
  if (!inJob) return null;
  const fromRef = /\.github\/workflows\/([^/@]+\.ya?ml)(?:@|$)/.exec(String(env?.GITHUB_WORKFLOW_REF ?? ''));
  if (fromRef) return fromRef[1];
  const raw = String(env?.GITHUB_WORKFLOW ?? '').trim();
  if (/\.ya?ml$/i.test(raw)) return raw.split('/').pop();
  return null;
}

/** PURE. Turns ONE redness answer into a verdict, so every branch is reachable
 *  from a test with no network — the same shell/pure split
 *  `classifyRunHistoryAnswer` and `classifyGlitchtipChecks` already use.
 *
 *  Four verdicts, and exactly one of them is "fine":
 *    · `green`      — the newest success is newer than the newest failure, or
 *                     there has never been a failure at all.
 *    · `red`        — RED SINCE. A LIVE verdict: `routeLiveVerdicts` decides, once
 *                     for every limb, whether THIS host's exit code carries it.
 *    · `unreadable` — no token, a throw, or an unorderable answer. PRINTS.
 *                     "I could not tell" is never "it is fine".
 *    · `blind`      — failures exist and no success does, so the comparison has
 *                     one term. A LIVE verdict at exit 2 wherever it blocks. */
export function classifyRedSince(row, probe) {
  const id = row.id;
  const q = row?.mechanism?.recordQuery ?? {};
  const unit = unitOf(q);
  const where = `${q.workflow} on ${q.headBranch}${unit.kind === 'run' ? '' : ` (${describeUnit(q)})`}`;
  if (!probe) return { verdict: 'unreadable', line: `${id} — the RED-SINCE read of ${where} produced no result at all on this run.` };
  if (probe.unreadable) return { verdict: 'unreadable', line: `${id} — the RED-SINCE read of ${where} could not run here: ${probe.why}` };
  // ⏱ 2026-09-25 [ADR 095 §4] The newest graded run lists a call job in a shape
  // nobody measured (`G4_UNMEASURED`): exit 2 wherever this row blocks.
  if (probe.lost) {
    return {
      verdict: 'lost',
      line:
        `${id} — ${where}: the newest run read, ${probe.lost.id} (${probe.lost.at}), cannot be graded — ${probe.lost.detail}. ` +
        'COVERAGE LOST for this row, neither a pass nor a RED.',
    };
  }

  const fail = probe.failure ?? null;
  const ok = probe.success ?? null;

  if (fail?.quotaOnly === true && (!ok || Date.parse(fail.at) > Date.parse(ok.at))) {
    return {
      verdict: 'quota',
      line:
        `${id} — ${where}: run ${fail.id} (${fail.at}) FAILED, and ${fail.cause}. That is GitHub refusing the job's token, ` +
        'not the duty failing: the run never reached a verdict about what it exists to check. COVERAGE LOST for this row, ' +
        `neither a pass nor a RED — ${ok ? `the newest success is run ${ok.id} at ${ok.at}` : 'no success exists to compare against'}. ` +
        'The installation quota resets within the hour; the next run on that branch that reaches a verdict replaces this one.',
    };
  }

  if (!fail) {
    if (ok && probe.newestDecisive) {
      return {
        verdict: 'green',
        line: `${id} — ${where}: the newest run in which that unit reached a verdict is run ${ok.id} (${ok.at}), and it SUCCEEDED.`,
      };
    }
    return {
      verdict: 'green',
      line: `${id} — ${where}: no FAILED run in its history at all${ok ? `, and the newest success is run ${ok.id} at ${ok.at}` : ''}.`,
    };
  }
  if (!ok) {
    return {
      verdict: 'blind',
      line:
        `${id} — ${where} has FAILED runs (newest is run ${fail.id} at ${fail.at}) and NO successful run at all, so ` +
        '"is the newest failure newer than the newest success" HAS NO SECOND TERM and this limb cannot order them.',
    };
  }
  const failMs = Date.parse(fail.at);
  const okMs = Date.parse(ok.at);
  if (!Number.isFinite(failMs) || !Number.isFinite(okMs)) {
    return {
      verdict: 'unreadable',
      line:
        `${id} — ${where}: a run came back whose timestamp does not parse (failure ${JSON.stringify(fail.at)}, ` +
        `success ${JSON.stringify(ok.at)}), so the two cannot be ordered. Refusing to read is not reading a pass.`,
    };
  }
  if (failMs > okMs) {
    if (ok.beyondPage) {
      return {
        verdict: 'red',
        line:
          `${id} — RED SINCE ${fail.at} AT THE LATEST: ${where} run ${fail.id} FAILED, and NO success of that unit appears ` +
          `in the newest ${ok.beyondPage} completed run(s) on that branch, back to ${ok.at}. This row's own ` +
          '`failingValue` is a failing conclusion; this is that value, live, and the duty is FAILING. A success of ' +
          'ANY event on that branch clears it — dispatch the workflow once the cause is fixed.',
      };
    }
    return {
      verdict: 'red',
      line:
        `${id} — RED SINCE ${fail.at}: ${where} run ${fail.id} FAILED, and the newest SUCCESSFUL run on that branch is ` +
        `run ${ok.id} at ${ok.at}, ${((failMs - okMs) / 3_600_000).toFixed(1)}h EARLIER. This row's own ` +
        '`failingValue` is a failing conclusion; this is that value, live, and the duty is FAILING. A success of ' +
        'ANY event on that branch clears it — dispatch the workflow once the cause is fixed.',
    };
  }
  return {
    verdict: 'green',
    line:
      `${id} — ${where}: newest success run ${ok.id} (${ok.at}) is newer than the newest failure run ${fail.id} ` +
      `(${fail.at}), by ${((okMs - failMs) / 3_600_000).toFixed(1)}h.`,
  };
}

/** PURE. `probes` is `Map<rowId, redSinceProbe>`; every impure thing has already
 *  happened. Returns `{ errors, prints, live, stats }` or `{ coverageLost }` for an
 *  EMPTY domain. Every RED and BLIND line is in `errors` AND in `live`; this
 *  function no longer decides where a verdict is routed — ⏱ 2026-09-11, that is
 *  `routeLiveVerdicts`, once for both limbs, because a router per limb is how the
 *  2026-09-09 exemption came to cover one limb and not the other. */
export function evaluateRedSince(reg, probes, dispatchable = null, postGate = null) {
  const errors = [];
  const prints = [];
  const live = [];
  const domain = redSinceDomain(reg, dispatchable, postGate);
  // ⏱ 2026-09-09. The shape rules for the `trigger` rows admitted above, which
  // `evaluateRunRecords` cannot state because its domain is the clocked rows.
  errors.push(...redSinceTriggerShape(reg));

  // 🔴 THE EMPTY DOMAIN, WHICH IS THE ONE WAY THIS LIMB COULD BE DISABLED
  // WITHOUT DELETING IT. Moving every workflow duty onto `unreachable`, onto
  // `trigger`/`on-demand`, or off `github-run-history` would leave this function
  // ranging over nothing and printing a serene `0 RED`. That is the exact defect
  // [14]O-3 was built to end one level down, and it gets the same answer here.
  if (domain.length === 0) {
    return {
      coverageLost: [
        'not one `duty.workflow.*` row is on a clock AND reads a named workflow on a named branch out of the GitHub run history,',
        'so the RED-SINCE limb ranges over the EMPTY SET and a red branch is silence again rather than an alarm.',
        'Moving the workflow duties onto `unreachable`, onto `trigger`/`on-demand`, or off `github-run-history` must',
        'not be the way to satisfy the one limb that grades a FAILED run. TRAPS ci-38 is the incident this refuses.',
      ],
    };
  }

  // 🔴 THE SHRINK, PRINTED — see `redSinceTriggerCensus`. Built here, before any
  // answer is classified, because it is a fact about the register and the
  // workflow tree and prints whether or not the live reads were made.
  const census = redSinceTriggerCensus(reg, dispatchable, postGate);
  const admittedText = census.admitted.map((id) => `${id} (${census.admittedBy[id]})`).join(' · ');
  const censusLines = [
    census.excluded.length
      ? `[14]O-3b — TRIGGER ROWS NOT GRADED FOR REDNESS: ${census.excluded.length} (admitted: ${admittedText || 'none'})`
      : `[14]O-3b — TRIGGER ROWS: every \`duty.workflow.*\` trigger row is graded for redness (${admittedText || 'there are none'}).`,
    ...census.excluded.map((l) => `[14]O-3b — NOT GRADED · ${l}`),
  ];
  // ⏱ 2026-09-11 — no answers on this host (`liveReadPlan`): the shape rules and
  // the empty-domain refusal above have run; nothing below has anything to order.
  if (probes === LIVE_READS_NOT_MADE) {
    prints.push(...censusLines);
    return { errors, prints, live: [], stats: { domain: domain.length, notRead: true } };
  }

  const tally = { green: 0, red: 0, unreadable: 0, blind: 0, quota: 0, lost: 0 };
  const darkLines = [];
  for (const r of domain) {
    const c = classifyRedSince(r, probes?.get?.(r.id));
    tally[c.verdict] = (tally[c.verdict] ?? 0) + 1;
    if (c.verdict === 'red') {
      errors.push(c.line);
      live.push({ id: r.id, line: c.line, code: 1, limb: '[14]O-3b' });
    } else if (c.verdict === 'blind') {
      const line =
        `${c.line} COVERAGE LOST for this row, which is neither a pass nor a RED: "since when" needs two terms and has ` +
        'one, and a first-ever run that failed is not distinguishable here from a history that does not reach back far ' +
        'enough. The duty is NOT unwatched — the sibling [14]O-3 limb still grades "no successful run at all" as FAILING.';
      errors.push(line);
      live.push({ id: r.id, line, code: 2, limb: '[14]O-3b' });
    } else if (c.verdict === 'quota' || c.verdict === 'lost') {
      errors.push(c.line);
      live.push({ id: r.id, line: c.line, code: 2, limb: '[14]O-3b' });
    } else if (c.verdict === 'unreadable') {
      darkLines.push(c.line);
    } else {
      prints.push(`[14]O-3b — ${c.line}`);
    }
  }

  // 🔴 THE NUMBER THAT MUST NEVER BE INVISIBLE: `0 RED over 7 workflows` and
  // `0 RED over 0 workflows` read identically unless the domain size is stated
  // beside the verdict, and the two admissions are counted SEPARATELY.
  const clocked = domain.filter((r) => TIME_CADENCE.test(String(r?.cadence ?? ''))).length;
  prints.push(
    `[14]O-3b — RED SINCE: ${domain.length} workflow duty(ies) graded (${clocked} on a clock · ` +
      `${domain.length - clocked} \`trigger\` row(s) whose workflow declares \`workflow_dispatch\` or whose unit is ` +
      `post-gate jobs of the gate workflow, so a red lane has an exit that is not a merge) · ${tally.green} whose newest run on their own ` +
      `branch is GREEN · ${tally.red} RED · ${tally.unreadable} unreadable on this runner · ` +
      `${tally.blind} with no success to compare against · ${tally.quota} whose newest failure died ONLY on the installation ` +
      `rate limit (COVERAGE LOST) · ${tally.lost} whose newest run lists a call job in an unmeasured shape (COVERAGE LOST) ` +
      '— whether each RED blocks THIS host is decided once, for ' +
      'every live verdict, under HOST POLICY below',
  );
  // 🔴 THE SHRINK, PRINTED — built above, before the answers were classified.
  prints.push(...censusLines);
  for (const l of darkLines) prints.push(`[14]O-3b — ${l}`);
  if (tally.green === 0 && tally.red === 0 && tally.blind === 0 && tally.quota === 0 && tally.lost === 0) {
    prints.push(
      '[14]O-3b — 🔴 THE RED-SINCE LIMB ORDERED ZERO PAIRS ON THIS RUN. Every watched workflow was unreadable here ' +
        '(no token, or the API could not be reached), so nothing above could have failed. This line exists so that ' +
        'state can never be mistaken for a green branch.',
    );
  }
  return { errors, prints, live, stats: { domain: domain.length, clocked, trigger: domain.length - clocked, ...tally } };
}

/** PURE. INV6 for the provider this guard's own host runs on. When EVERY
 *  RED-SINCE read — each of them a GitHub API read — came back unreadable, the
 *  runner has lost the GitHub API (a lost GITHUB_TOKEN, a revoked `actions: read`,
 *  an outage), and that is COVERAGE LOST, not a quiet branch. The unreadable
 *  ceiling was meant to be broken by exactly this, and never was: 11 GitHub-backed
 *  rows under a ceiling of 12 (REVIEW-guards-2026-09-10 #2). Returns a line, or null. */
export function githubDarkness(redProbes) {
  const all = [...(redProbes?.values?.() ?? [])];
  if (all.length === 0 || !all.every((p) => p?.unreadable)) return null;
  return (
    `every one of the ${all.length} RED-SINCE read(s) against the GitHub API was unreadable on this run (first reason: ` +
    `${all[0].why}). GitHub is the provider this guard's own host runs on, so this is a lost token, a revoked ` +
    '`actions: read` or an API outage — the state the unreadable ceiling was built to be broken by and, at 11 ' +
    'GitHub-backed rows under a ceiling of 12, never was (REVIEW-guards-2026-09-10 #2).'
  );
}

/** Both halves of the redness comparison, at the SAME width: branch only, event
 *  filter dropped, per the header above. The impure shell only; it holds no
 *  verdict logic.
 *
 *  TWO REQUESTS RATHER THAN ONE PAGE OF `status=completed`, and the reason is
 *  `cancelled`. A cancelled run is neither a success that clears a red nor a
 *  failure that starts one, and on a busy branch a page of them would push both
 *  real answers off it — so the newest-completed shape would let a cancellation
 *  change the verdict simply by being newest. Asking each conclusion for its own
 *  newest run cannot be moved by a third one. */
async function probeGithubRedSince(q, repo, cache = new Map()) {
  const br = `branch=${encodeURIComponent(q.headBranch)}`;
  const newest = async (status) => {
    // Two reads, two widths, reconciled — see the RUN_READ_RACE_MS block above.
    // A stale FAILURE read is the direction that HIDES a red on this limb, so
    // the cross-check matters here even more than it does for freshness.
    const run = await ghNewestRun(
      repo,
      q.workflow,
      [br, `status=${status}`],
      `the newest ${status} run of ${q.workflow} on ${q.headBranch}`,
    );
    if (!run) return null;
    // 🔴 THE FILTER IS THE REQUEST; THIS IS THE ANSWER, CHECKED — the same rule
    // `classifyRunHistoryAnswer` states and for a sharper reason here. A
    // `branch=` silently ignored by a future API version would compare two runs
    // from two different branches and freeze the queue over a feature branch's
    // failure; a `status=` silently ignored would compare a run against itself.
    // A throw here becomes `unreadable`, which prints and never passes.
    if (run.head_branch !== q.headBranch) {
      throw new Error(
        `the branch filter did not hold for ${q.workflow}: asked for ${JSON.stringify(q.headBranch)} and run ${run.id} ` +
          `came back on ${JSON.stringify(run.head_branch ?? null)}`,
      );
    }
    if (run.conclusion !== status) {
      throw new Error(
        `the status filter did not hold for ${q.workflow}: asked for ${status} and run ${run.id} came back ` +
          `${JSON.stringify(run.conclusion ?? null)}`,
      );
    }
    return { id: run.id, at: run.updated_at };
  };
  return withQuotaCause({ success: await newest('success'), failure: await newest('failure') }, repo, cache);
}

/** The impure orchestrator. One row per workflow by construction (the register
 *  holds `watched workflows === .github/workflows/*.yml` in both directions), so
 *  there is nothing to de-duplicate. A "run" unit is read by the two-status read
 *  above, unchanged; a job or step unit by `probeUnitRedSince` (INV3), sharing one
 *  job-list cache with the freshness limb. */
async function probeRedSince(reg, dispatchable = null, parsedByFile = new Map(), jobsCache = new Map(), postGate = null) {
  const probes = new Map();
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  for (const r of redSinceDomain(reg, dispatchable, postGate)) {
    if (!ghToken()) {
      probes.set(r.id, {
        unreadable: true,
        why: 'neither GITHUB_TOKEN nor GH_TOKEN is in the environment, so the run history cannot be read',
      });
      continue;
    }
    const q = r.mechanism.recordQuery;
    try {
      const u = unitOf(q);
      if (u.kind === 'invalid') throw new Error('the row names no readable unit');
      probes.set(
        r.id,
        u.kind === 'run'
          ? await probeGithubRedSince(q, repo, jobsCache)
          : await probeUnitRedSince(q, repo, parsedByFile.get(String(q.workflow)) ?? null, jobsCache),
      );
    } catch (e) {
      // 🔴 An error is UNREADABLE, never a pass and never a red. "I could not
      // tell" must not read as "the branch is green", and it must not redden CI
      // on a transient 502 either — the print carries the reason, so a
      // persistent one is visible on every run, and a GitHub API that answers
      // none of these reads is COVERAGE LOST (`githubDarkness`).
      probes.set(r.id, { unreadable: true, why: `the query threw: ${e.message}` });
    }
  }
  return probes;
}

/** duty.renovate's record is the Dependency Dashboard issue: Renovate rewrites
 *  it every time it runs, so its `updated_at` IS the run record. The absence of
 *  the issue is the interesting case and it is a hard failure, not a pass — a
 *  Renovate that has stopped being installed leaves exactly no branches and
 *  exactly no dashboard, which looks identical to a quiet week. */
async function probeGithubIssue(q, repo) {
  const query = `repo:${repo} is:issue in:title "${q.titleContains}"`;
  const body = await ghJson(`/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=1`);
  const hit = body?.items?.[0];
  if (!hit) {
    return { missing: true, why: `no issue whose title contains "${q.titleContains}" exists in ${repo}` };
  }
  return { lastSuccessMs: Date.parse(hit.updated_at), detail: `issue #${hit.number} "${hit.title}" last updated ${hit.updated_at}.` };
}

/** cron_heartbeat, over the D1 HTTP API, from OUTSIDE Cloudflare — the same
 *  transport check-heartbeats.mjs uses. `WHERE ok = 1` is the whole point: three
 *  consecutive nights of rows landed here while every one of them was an HTTP
 *  401, so "a row exists" and "the duty ran" are different questions. */
async function probeCloudflareHeartbeat(q, root) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    return { unreadable: true, why: 'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment' };
  }
  let dbId = null;
  try {
    const cfg = parseJsonc(readFileSync(join(root, q.wrangler), 'utf8'));
    dbId = (cfg.d1_databases ?? []).find((d) => d.migrations_dir)?.database_id ?? null;
  } catch (e) {
    return { unreadable: true, why: `${q.wrangler} could not be read for its database_id (${e.message})` };
  }
  if (!dbId) return { unreadable: true, why: `${q.wrangler} carries no D1 binding with a migrations_dir, so the heartbeat database cannot be resolved` };
  // `q.table` is register text interpolated straight into SQL — D1 cannot bind
  // an identifier, so the string is built by hand and a register is not a trust
  // boundary anybody audits. Refused rather than quoted, the same rule the
  // erasure routes apply to names they take from sqlite_master.
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(String(q.table ?? ''))) {
    return { unreadable: true, why: `\`recordQuery.table\` is not a plain identifier: ${JSON.stringify(q.table)}` };
  }
  // 🔴 `job` AND `target` NARROW THIS READ TO ONE CLAIM, AND THEY ARE BOUND, NOT
  // INTERPOLATED. The table above is an identifier, which SQL cannot parameterise
  // — these are VALUES, which it can, so the register text never reaches the SQL
  // string at all. A narrowed read is what Phase 2 needs: `duty.platform-cron`
  // asks "is the cron alive at all", and the stalest-of-all-jobs answer is right
  // for it, but a workflow duty asks "did the TIMER fire THIS workflow", and the
  // whole-table answer would let a healthy retention sweep vouch for a dispatcher
  // that has not fired e2e.yml in a week.
  const where = ['ok = 1'];
  const params = [];
  if (q.job !== undefined) { where.push('job = ?'); params.push(String(q.job)); }
  if (q.target !== undefined) { where.push('target = ?'); params.push(String(q.target)); }
  const narrowed = params.length > 0;
  const sql = narrowed
    ? `SELECT job, target, MAX(ran_at) AS ran_at FROM ${q.table} WHERE ${where.join(' AND ')}`
    : `SELECT job, MAX(ran_at) AS ran_at FROM ${q.table} WHERE ok = 1 GROUP BY job`;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`the D1 API returned ${res.status}`);
  const body = await res.json();
  if (body?.success !== true) throw new Error(`the D1 API reported failure: ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`);
  const rows = body?.result?.[0]?.results ?? [];
  const label = narrowed ? `${q.table} for ${describeNarrowing(q)}` : q.table;
  // ⚠️ A BARE `MAX()` WITH NO GROUP BY RETURNS ONE ROW WHOSE `ran_at` IS NULL when
  // nothing matches — so "no rows" and "one row of nulls" are the SAME answer and
  // both must reach the bootstrap branch. Checking `rows.length` alone would read
  // that null as a parse failure further down and report the duty FAILING rather
  // than never-yet-recorded, which is the difference between "your cron is dead"
  // and "your cron has not had its first slot".
  const matched = rows.filter((r) => typeof r?.ran_at === 'string' && r.ran_at !== '');
  if (matched.length === 0) return { lastSuccessMs: NaN, detail: `${label} holds no row with ok = 1.` };
  // The OLDEST of the per-job newest successes: one silent job inside a cron
  // that runs several is exactly the [4]B-11 finding (half the cron invisible),
  // so the duty is only as fresh as its stalest watched job.
  const stalest = matched.reduce((a, b) => (Date.parse(a.ran_at) <= Date.parse(b.ran_at) ? a : b));
  return {
    lastSuccessMs: Date.parse(stalest.ran_at),
    detail: narrowed
      ? `${label} last succeeded at ${stalest.ran_at}.`
      : `${matched.length} job(s) with an ok = 1 row; the STALEST is \`${stalest.job}\` at ${stalest.ran_at}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE TIMER TARGET IS A STRING TWO FILES HAVE TO AGREE ON, AND NOTHING MADE
// THEM. This guard exists because the first Phase 2 row shipped BROKEN: the
// Worker writes `${repo}/${workflow}` — "Nikatru_Platform_Public/e2e.yml" — and
// the register declared the bare "e2e.yml", which `probeCloudflareHeartbeat`
// binds as an EXACT equality. Zero rows matched, MAX() returned one NULL row,
// and the duty landed in the bootstrap branch, where `firstDue` masked it
// completely. It would have gone red the instant that date passed, freezing the
// merge queue — the precise failure the whole increment was built to end.
//
// ⚠️ AND THE TEST DID NOT CATCH IT, BECAUSE THE TEST ASSERTED THE SAME WRONG
// STRING. A hand-written expectation checked against a hand-written register is
// two copies of one belief, not a verification: nothing tied either to the
// PRODUCER. So this reads the target strings out of the Worker source and holds
// the register against them — the bijection, not a spot check.
// ─────────────────────────────────────────────────────────────────────────────

/** The `job` the dispatcher records under. Kept as a literal on purpose: the
 *  Worker exports the same constant, and the check below fails if that export
 *  stops existing, rather than silently ranging over nothing. */
const DISPATCH_JOB = 'github_dispatch';
const DISPATCHER_SRC_REL = 'services/platform/src/scheduled.ts';

/** Pure. Given the Worker's source, returns the exact `target` strings it will
 *  write, or a reason it could not be read. Never guesses: an unreadable source
 *  is COVERAGE LOST, because a check that ranges over an empty set passes. */
export function dispatchTargetsFromSource(src) {
  const clean = stripSourceComments(src, '.ts');
  // The template the writer uses. If this shape moves, every target string
  // moves with it, so it is read rather than assumed.
  const tpl = clean.match(/const\s+target\s*=\s*`([^`]*)`/);
  if (!tpl) return { error: 'no `const target = \\`…\\`` template found — the dispatcher no longer builds its heartbeat target the way this guard reads it' };
  const shape = tpl[1].trim();
  if (shape !== '${t.repo}/${t.workflow}') {
    return { error: `the dispatcher builds its target as \`${shape}\`, which this guard does not know how to reproduce. Teach it the new shape, or the register's declared targets are unverified.` };
  }
  const block = clean.match(/GITHUB_DISPATCH_TARGETS[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) return { error: 'GITHUB_DISPATCH_TARGETS array not found in the dispatcher source' };
  const targets = [...block[1].matchAll(/repo:\s*'([^']+)'[\s\S]*?workflow:\s*'([^']+)'/g)].map((m) => `${m[1]}/${m[2]}`);
  if (targets.length === 0) return { error: 'GITHUB_DISPATCH_TARGETS parsed to ZERO entries, so every comparison below would be vacuous' };
  return { targets };
}

/** Holds every `github_dispatch` timer limb against what the Worker really
 *  writes. Returns problem strings; empty means agreement. */
export function checkTimerTargetsAgainstDispatcher(reg, src) {
  const { targets, error } = dispatchTargetsFromSource(src);
  const rows = (reg.rows ?? []).filter((r) => r?.mechanism?.recordQuery?.timer?.job === DISPATCH_JOB);
  if (rows.length === 0) return [];
  if (error) return [`${DISPATCHER_SRC_REL} — ${error} ${rows.length} register row(s) declare a \`${DISPATCH_JOB}\` timer whose target cannot therefore be verified.`];
  const known = new Set(targets);
  const problems = [];
  for (const r of rows) {
    const t = r.mechanism.recordQuery.timer.target;
    if (t === undefined) continue; // the narrowing rule already covers this
    if (!known.has(t)) {
      problems.push(
        `${r.id} — \`recordQuery.timer.target: ${JSON.stringify(t)}\` is not a target the dispatcher writes. ` +
          `It writes: ${targets.map((x) => `\`${x}\``).join(', ')}. The probe binds this as an EXACT equality, so a ` +
          'near-miss matches ZERO rows and the duty reads as "never recorded" rather than as a mismatch — which ' +
          '`firstDue` then hides until it expires.',
      );
    }
  }
  return problems;
}

/** Which external provider a reader depends on. `unreachable` and the local
 *  Windows reader depend on no network provider and so cannot be knocked out by
 *  one going dark. */
const READER_PROVIDER = {
  'github-run-history': 'github',
  'github-issue-activity': 'github',
  'cloudflare-d1-heartbeat': 'cloudflare',
  'glitchtip-heartbeat': 'glitchtip',
};

/** Pure. Re-derives `_maxUnreadable` from the rows, so the constant cannot drift
 *  from the rule it claims to follow.
 *
 *  ⚠️ A ROW WITH A `timer` LIMB COUNTS TWICE — once for each provider. Either
 *  one going dark makes `combineLimbProbes` return unreadable for that row, so
 *  it is genuinely exposed to both, and counting it once would under-state the
 *  blast radius of exactly the change that introduced it. */
export function deriveUnreadableCeiling(reg) {
  const counts = new Map();
  const bump = (p) => { if (p && p !== 'github') counts.set(p, (counts.get(p) ?? 0) + 1); };
  for (const r of reg.rows ?? []) {
    if (r?.kind !== 'duty' || !TIME_CADENCE.test(String(r?.cadence ?? ''))) continue;
    const q = r?.mechanism?.recordQuery;
    if (!q) continue;
    bump(READER_PROVIDER[q.reader]);
    if (q.timer) bump(READER_PROVIDER[q.timer.reader]);
  }
  const perProvider = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const worst = perProvider.length ? perProvider[0][1] : 0;
  return { ceiling: worst + 1, perProvider, worst };
}

/** Names the narrowing in the same words the register used, so a failing line
 *  says which claim went stale rather than just naming the table. */
export function describeNarrowing(q) {
  const bits = [];
  if (q.job !== undefined) bits.push(`job \`${q.job}\``);
  if (q.target !== undefined) bits.push(`target \`${q.target}\``);
  return bits.join(' + ');
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE TWO-LIMB READ — WORKER CRON PHASE 2, AND IT IS NOT A FILTER SWAP.
//
// A duty on a clock makes TWO claims, and until now one query answered both by
// accident. `event=schedule&status=success` said "the timer fired" AND "the run
// passed", fused, because only GitHub's scheduler could produce that event.
//
// Moving the trigger to a Cloudflare cron breaks the fusion: a dispatched run
// arrives as `event=workflow_dispatch`, which is INDISTINGUISHABLE FROM A HAND
// PRESS. Widening the event filter to accept it is the tempting one-line fix and
// it is the wrong one — freshness would then be green on somebody being awake,
// the exact defect assert-platform-proof-fresh.mjs was built to prevent
// ("counting manual runs is what let a never-firing cron look healthy").
//
// So the claims are read SEPARATELY, from two records with different authors:
//   · TIMER   — the `cron_heartbeat` row the dispatching Worker writes. A record
//               only the timer can write; no human hand produces one.
//   · OUTCOME — the run history, event filter DROPPED, `head_branch` REQUIRED.
//               It no longer has to prove the timer, so accepting any event is
//               safe — but the branch guarantee was riding on the event filter
//               (GitHub fires schedules only on the default branch), so dropping
//               one without naming the other would silently widen this to "a
//               green run on any branch". That is why `headBranch` is mandatory.
//
// The duty is only as fresh as its STALER limb, and both must sit inside the
// window. A dispatcher that fires into a workflow that then fails is not fresh;
// a workflow that passes on a hand-press while the timer is dead is not either.
// ─────────────────────────────────────────────────────────────────────────────

/** Pure. Merges the timer and outcome probes into the single probe shape
 *  `classifyRunRecord` already understands, so the verdict logic gains no new
 *  branches and every one of these cases is reachable with no network. */
export function combineLimbProbes(outcome, timer) {
  // Order matters: unreadable BEFORE missing before bootstrap, and each names
  // WHICH limb, because "the duty is stale" and "the D1 token is absent on this
  // runner" are different facts and the second must never print as the first.
  for (const [limb, p] of [['timer', timer], ['outcome', outcome]]) {
    if (!p) return { unreadable: true, why: `its ${limb} limb produced no result at all` };
    if (p.unreadable) return { unreadable: true, why: `its ${limb} limb could not be read: ${p.why}` };
  }
  for (const [limb, p] of [['timer', timer], ['outcome', outcome]]) {
    if (p.missing) return { missing: true, why: `its ${limb} limb: ${p.why}` };
  }
  const bad = (p) => typeof p.lastSuccessMs !== 'number' || Number.isNaN(p.lastSuccessMs);
  // Bootstrap propagates: a row repointed onto a dispatcher that has not fired
  // yet has an empty timer record for a reason that is not the duty being
  // broken, and `firstDue` is what bounds that wait. Reporting the OUTCOME's
  // healthy timestamp while the timer record is empty would hide exactly the
  // gap this limb was added to expose.
  if (bad(timer)) return { lastSuccessMs: NaN, detail: `TIMER: ${timer.detail ?? 'no record.'} OUTCOME: ${outcome.detail ?? '—'}` };
  if (bad(outcome)) return { lastSuccessMs: NaN, detail: `OUTCOME: ${outcome.detail ?? 'no record.'} TIMER: ${timer.detail}` };
  const stalerIsTimer = timer.lastSuccessMs <= outcome.lastSuccessMs;
  return {
    lastSuccessMs: Math.min(timer.lastSuccessMs, outcome.lastSuccessMs),
    detail:
      `the STALER limb is ${stalerIsTimer ? 'the TIMER' : 'the OUTCOME'}. ` +
      `TIMER: ${timer.detail} OUTCOME: ${outcome.detail}`,
  };
}

/** Pure. Turns ONE monitor payload plus ONE page of its checks into a probe
 *  result, so every branch is reachable from a test with no network and no live
 *  monitor. `probeGlitchtipHeartbeat` is the impure shell around it and holds no
 *  verdict logic of its own — the same split `classifyScheduledTaskRow` and
 *  `probeWindowsTasks` already use, and for the same reason: a reader whose only
 *  evidence is "it worked against production today" has no recorded failing
 *  case, and this file's rule is that an assertion which cannot fail is worse
 *  than none. */
export function classifyGlitchtipChecks(monitor, checks, q = {}) {
  // A monitor converted from Heartbeat to GET no longer records THIS DUTY at
  // all: it records whether a URL answers, which is a different fact that would
  // go on looking healthy forever while the duty never ran again. The query RAN
  // and answered, so this is `missing`, not `unreadable`.
  if (monitor?.monitorType !== 'Heartbeat') {
    return {
      missing: true,
      why:
        `GlitchTip monitor ${q.monitor} exists but its type is ${JSON.stringify(monitor?.monitorType ?? null)}, not "Heartbeat" — ` +
        'it no longer records this duty POSTing on success, so nothing about the duty can be read from it',
    };
  }
  if (!Array.isArray(checks)) {
    // NOT `lastSuccessMs: NaN` — that would assert "no successful run" over a
    // payload nothing understood. Refusing to read is not reading a failure.
    return { unreadable: true, why: `the checks endpoint for monitor ${q.monitor} did not return an array` };
  }
  const up = checks.filter((c) => c?.isUp === true && Number.isFinite(Date.parse(c?.startCheck ?? '')));
  if (up.length === 0) {
    // 🔴 THE BRANCH THIS WHOLE READER EXISTS FOR, and it is a FAILURE rather
    // than a print. An empty page and a page of nothing but misses both mean the
    // duty has not POSTed a success this query can see, and `classifyRunRecord`
    // turns `lastSuccessMs: NaN` into "its record IS reachable and holds NO
    // SUCCESSFUL RUN AT ALL". A heartbeat dead long enough to push its last
    // success off the newest page lands here too, which is correct: that is not
    // a duty anybody should be told is fine.
    return {
      lastSuccessMs: NaN,
      detail:
        `GlitchTip monitor ${q.monitor} exists and the newest ${checks.length} check(s) contain NO successful heartbeat — ` +
        'the duty has not POSTed a success in any of them.',
    };
  }
  const newest = up.reduce((a, b) => (Date.parse(a.startCheck) >= Date.parse(b.startCheck) ? a : b));
  const missed = checks.filter((c) => c?.isUp === false).length;
  return {
    lastSuccessMs: Date.parse(newest.startCheck),
    detail:
      `GlitchTip monitor ${q.monitor} (Heartbeat, interval ${monitor.interval}s): newest SUCCESSFUL heartbeat at ` +
      `${newest.startCheck}, from ${checks.length} check(s) on the newest page (${missed} of them recording a miss).`,
  };
}

/** A GLITCHTIP HEARTBEAT MONITOR, read from outside — the duty POSTs on success
 *  and the monitor records that POST as a check. The newest check with
 *  `isUp: true` IS the duty's last successful run, which is the one question
 *  [14]O-3 asks.
 *
 *  🔴 WHY THIS READER EXISTS AT ALL, because the obvious alternative is what it
 *  replaces. `duty.laptop.nikatru-daily-backup` used to be read by
 *  `windows-scheduled-task`, which is structurally unreadable on every Linux
 *  runner — CI has no Task Scheduler and never will. That was tolerable only
 *  while the row ALSO held `lastObserved: fail`, because a held failure
 *  classifies as FAILING rather than as a print. On 2026-09-02 the backup was
 *  repaired, the held failure was correctly cleared to `pass`, and the row fell
 *  through to plain `unreadable` — taking the count to 8 against a ceiling of 7
 *  and reddening the register's own end-to-end test. THE TWO TEMPTING FIXES ARE
 *  BOTH WEAKENING: raising the ceiling makes the limb believe itself over a
 *  domain it did not read, and teaching the held-failure regex to accept
 *  `PASSING` inverts the evidence — a self-reported FAILURE is an admission
 *  against interest, a self-reported success is not. The honest fix is to give
 *  the duty a record a Linux runner CAN query, and the duty already had one: it
 *  has POSTed to a GlitchTip heartbeat since 2026-07-27, and the register has
 *  named that monitor as its `absenceWatcher` the whole time.
 *
 *  🔴 KEYED BY `id`, NEVER BY `name`. A monitor's name is prose somebody edits:
 *  on 2026-09-02 `Oracle box backup chain` was renamed to `GlitchTip backup
 *  chain (Box B)` and `tooling/ops/alarm-chains.json`, which keys by name, went
 *  COVERAGE LOST on the next Ops watch run. The id survived that rename
 *  untouched. `monitorName` is carried in the register for a human reading the
 *  row and is deliberately NOT asserted on, so a future rename cannot redden
 *  this limb for a reason that has nothing to do with the duty.
 *
 *  ⚠️ A NETWORK FAILURE HERE MUST NEVER BLOCK A MERGE. `probeRunRecords` catches
 *  the throw into `unreadable`, which PRINTS and only fails once the ceiling is
 *  exceeded — so a Box B outage costs one line of output, not the merge queue.
 *  That is the condition under which ci.yml's standing objection to a CI limb
 *  depending on the GlitchTip box ("would make every build depend on the Oracle
 *  box, which is the very SPOF E-9b is about") is satisfied rather than ignored,
 *  and it is why `_maxUnreadable` must keep headroom for every row read this
 *  way rather than being ratcheted to exactly the count measured on a good day. */
async function probeGlitchtipHeartbeat(q) {
  const token = process.env.GLITCHTIP_TOKEN;
  if (!token) {
    return { unreadable: true, why: 'GLITCHTIP_TOKEN is not in the environment, so the monitor\'s check history cannot be read' };
  }
  const base = (process.env.GLITCHTIP_URL ?? 'https://glitchtip.nikatru.com').replace(/\/+$/, '');
  // Both are interpolated into a URL path. The register is not a trust boundary
  // anybody audits, so they are REFUSED rather than escaped — the same rule
  // `probeCloudflareHeartbeat` applies to the table identifier it is handed.
  if (!/^[0-9]+$/.test(String(q.monitor ?? ''))) {
    return { unreadable: true, why: `\`recordQuery.monitor\` is not a numeric monitor id: ${JSON.stringify(q.monitor ?? null)}` };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(String(q.org ?? ''))) {
    return { unreadable: true, why: `\`recordQuery.org\` is not a plain organisation slug: ${JSON.stringify(q.org ?? null)}` };
  }
  const url = `${base}/api/0/organizations/${q.org}/monitors/${q.monitor}/`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  // 🔴 404 IS AN ANSWER, NOT A FAILURE TO READ. The query ran and GlitchTip said
  // the monitor the register names is gone — the stale-row case this file's own
  // header calls strictly worse than an absent one, because the register would
  // go on asserting a duty watched by something that no longer exists.
  if (res.status === 404) {
    return { missing: true, why: `GlitchTip has no monitor ${q.monitor} in organisation \`${q.org}\` — the id the register names returns 404` };
  }
  if (!res.ok) throw new Error(`the GlitchTip API returned ${res.status} ${res.statusText} for monitor ${q.monitor}`);
  const monitor = await res.json();
  // Newest-first, capped at the API's page size. Every heartbeat POST creates a
  // check, so page one covers the recent past densely.
  const checksRes = await fetch(`${url}checks/`, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!checksRes.ok) throw new Error(`the GlitchTip API returned ${checksRes.status} ${checksRes.statusText} for monitor ${q.monitor} checks`);
  return classifyGlitchtipChecks(monitor, await checksRes.json(), q);
}

async function probeRunRecords(reg, root, parsedByFile = new Map(), jobsCache = new Map()) {
  const probes = new Map();
  const scheduled = (reg.rows ?? []).filter((r) => r.kind === 'duty' && TIME_CADENCE.test(String(r?.cadence ?? '')));
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;

  const winRows = scheduled.filter((r) => r?.mechanism?.recordQuery?.reader === 'windows-scheduled-task');
  if (winRows.length) {
    const byTask = probeWindowsTasks(winRows.map((r) => r.mechanism.recordQuery.task));
    for (const r of winRows) probes.set(r.id, byTask.get(r.mechanism.recordQuery.task));
  }

  for (const r of scheduled) {
    const q = r?.mechanism?.recordQuery;
    if (!q || q.reader === 'unreachable' || q.reader === 'windows-scheduled-task') continue;
    try {
      if (q.reader === 'github-run-history' || q.reader === 'github-issue-activity') {
        if (!ghToken()) {
          probes.set(r.id, { unreadable: true, why: 'neither GITHUB_TOKEN nor GH_TOKEN is in the environment, so the run history cannot be read' });
          continue;
        }
        let outcome;
        if (q.reader === 'github-issue-activity') {
          outcome = await probeGithubIssue(q, repo);
        } else {
          // INV3 — a job or step unit is read from the jobs of each run; a "run"
          // unit keeps the whole-run read, which is correct for a run that IS the duty.
          const u = unitOf(q);
          if (u.kind === 'invalid') throw new Error('the row names no readable unit');
          outcome = u.kind === 'run'
            ? await probeGithubRun(q, repo)
            : await probeUnitFreshness(q, repo, parsedByFile.get(String(q.workflow)) ?? null, jobsCache);
        }
        // A `timer` limb makes this a TWO-RECORD read: the run history above is
        // now the OUTCOME only, and the cadence claim comes from the heartbeat
        // row the dispatching Worker writes. See combineLimbProbes.
        probes.set(r.id, q.timer ? combineLimbProbes(outcome, await probeCloudflareHeartbeat(q.timer, root)) : outcome);
      } else if (q.reader === 'cloudflare-d1-heartbeat') {
        probes.set(r.id, await probeCloudflareHeartbeat(q, root));
      } else if (q.reader === 'glitchtip-heartbeat') {
        probes.set(r.id, await probeGlitchtipHeartbeat(q));
      }
    } catch (e) {
      // 🔴 An error is UNREADABLE, never a pass and never a fail. "I could not
      // tell" must not read as "it is fine" (check-heartbeats.mjs's own rule),
      // and it must not redden CI on a transient 502 either — the print carries
      // the reason so a persistent one is visible on every run.
      probes.set(r.id, { unreadable: true, why: `the query threw: ${e.message}` });
    }
  }
  return probes;
}

// ─────────────────────────────────────────────────────────────────────────────
// The impure half: read the tree, run the coverage self-checks that only make
// sense against a real repository, then hand the pure half its inputs.
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const registerPath = join(ROOT, REGISTER_REL);
  if (!existsSync(registerPath)) {
    coverageLost([
      `${REGISTER_REL} does not exist under ${ROOT}.`,
      'Eighteen of stage 14\'s acceptance criteria quantify over this file. Without it they range over the',
      'empty set and every one of them reports clean — which is the state this guard was built to end.',
    ]);
  }

  let reg;
  try {
    reg = JSON.parse(readFileSync(registerPath, 'utf8'));
  } catch (e) {
    coverageLost([`${REGISTER_REL} could not be parsed (${e.message}).`, 'An unreadable register is an absent register.']);
  }

  // ── the workflow set, cross-checked against what git actually tracks ──────
  const wfDir = join(ROOT, WORKFLOW_DIR_REL);
  if (!existsSync(wfDir)) {
    coverageLost([`${WORKFLOW_DIR_REL} does not exist, so the workflow coverage relationship ranged over nothing.`]);
  }
  const workflows = listDir(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort();
  if (workflows.length === 0) {
    coverageLost([`${WORKFLOW_DIR_REL} contains no workflow files, so every duty row would be trivially satisfied.`]);
  }
  const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', WORKFLOW_DIR_REL], { encoding: 'utf8' });
  const tracked =
    ls.status === 0
      ? [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ya?ml$/.test(l)).map((l) => l.split('/').pop()))]
      : [];
  if (tracked.length === 0) {
    if (scanningRealRepo) {
      coverageLost([
        `\`git ls-files -- ${WORKFLOW_DIR_REL}\` returned no tracked workflow under ${ROOT}.`,
        'The committed manifest is what anchors "did I see every workflow"; without it the relationship below',
        'is computed over whatever happened to be on disk and still prints ok.',
      ]);
    }
  } else {
    const unseen = tracked.filter((t) => !workflows.includes(t));
    if (unseen.length) {
      coverageLost([
        `git tracks ${tracked.length} workflow(s) and this scan opened ${workflows.length}; it never saw: ${unseen.join(', ')}.`,
        'An unseen workflow is a duty nobody has to classify, and the register would still report full coverage.',
      ]);
    }
  }

  // ── wrangler configs: crons and custom-domain routes ──────────────────────
  const { found: wranglers } = findWranglerConfigs(ROOT);
  if (wranglers.length === 0) {
    coverageLost([
      `no live wrangler config found under ${ROOT}.`,
      'The cron-duty and surface relationships both derive from these files, so an empty set makes both',
      'vacuously true — the shape check-migrations.mjs shipped with when it silently dropped a file.',
    ]);
  }

  const cronConfigs = [];
  const customDomains = [];
  for (const rel of wranglers) {
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(join(ROOT, rel), 'utf8'));
    } catch (e) {
      coverageLost([`${rel} could not be parsed (${e.message}), so its crons and routes are invisible to this scan.`]);
    }
    if (Array.isArray(cfg?.triggers?.crons) && cfg.triggers.crons.length) cronConfigs.push(rel);
    for (const r of cfg?.routes ?? []) {
      if (r?.custom_domain === true && nonEmpty(r.pattern)) customDomains.push(r.pattern);
    }
  }

  // Every file the register anchors to must be checkable, so build the path set
  // once. `Private/` is excluded from the tree by .gitignore and is handled
  // separately and loudly in the pure half.
  const paths = new Set();
  const collect = (dir, rel) => {
    let entries;
    try { entries = listDir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'build') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      paths.add(r);
      if (e.isDirectory()) collect(join(dir, e.name), r);
    }
  };
  collect(ROOT, '');

  // ── [14]O-7 · the deploy-job domain, DERIVED from the recorded claims ─────
  // Parsed through the shared workflow parser rather than grepped: a `run: |`
  // block is joined with ` ; ` and a `run: >` block folded with spaces, so a
  // flat regex sees different text depending on which block style the step
  // happens to use — four copies of a workflow parser drift in exactly the way
  // that reports "clean".
  //
  // 🔴 THE ENVIRONMENT ARGUMENT CAN BE A MATRIX LEG, and this file's own copy of
  // the call-site regex could not see one. [10]D-2b made deploy-web.yml a matrix
  // over the workspace app set, so its record step reads
  // `record-deployment.mjs ${{ matrix.app }}-web`, and `[A-Za-z0-9._-]+` matched
  // NOTHING after the `\s+` there: `envs` came back empty, the `continue` below
  // dropped the web deploy job entirely, and this limb's domain fell from FIVE
  // deploy jobs to four while printing the smaller number as a pass. The house
  // failure mode — a check that silently stopped checking — reproduced by a
  // refactor that made the tree strictly better. The reader is now
  // workflow-scan.mjs's `RECORD_CALL`, shared with assert-publish-records.mjs
  // and deployment-record.test.mjs, which is where the three disagreeing copies
  // are written up.
  const deployJobs = [];
  // The app catalogue a matrix leg expands over — the same file
  // assert-publish-records.mjs builds the REQUIRED environment set from, so the
  // recorded environment and the required one are two readings of one list.
  let appSlugs = [];
  const catalogue = join(ROOT, 'catalog', 'apps.json');
  if (existsSync(catalogue)) {
    try {
      const cat = JSON.parse(readFileSync(catalogue, 'utf8'));
      if (Array.isArray(cat)) appSlugs = cat.map((a) => a?.slug).filter((s) => typeof s === 'string');
    } catch { /* falls into the floor below */ }
  }
  const expandEnv = (raw) => {
    const expanded = expandMatrixEnvironment(raw, appSlugs);
    if (expanded.length === 0) {
      coverageLost([
        `a deploy job records \`${raw}\` and the app catalogue at catalog/apps.json yielded no slug.`,
        'The environment cannot be expanded, so this limb would attribute the deploy to a literal `${{ … }}`',
        'and never match an exemption or a register row — an unreadable domain reported as a clean one.',
      ]);
    }
    return expanded;
  };
  for (const wf of parseAllWorkflows(ROOT)) {
    for (const [jobName, job] of wf.jobs) {
      const text = (job.lines ?? []).map((l) => l.text ?? String(l)).join('\n');
      RECORD_CALL.lastIndex = 0;
      const envs = [...text.matchAll(RECORD_CALL)].flatMap((m) => expandEnv(m[1]));
      // 🔴 THE FLOOR THAT WAS MISSING, AND ITS ABSENCE DROPPED A JOB TWICE.
      // The line below used to be a bare `continue`, and a bare `continue` cannot
      // tell "this job records nothing" from "this job records something I could
      // not read". [10]D-2b's matrix leg hit it in 2026-08-07 and the reader was
      // widened; the `continue` was left, so build-platforms.yml's
      // `record-deployment.mjs "$environment"` hit the SAME line on 2026-08-26
      // and this limb's census printed 7 deploy jobs without the release job in
      // it. Widening the reader a second time fixes one call site. THIS fixes the
      // shape: a job whose text names the recorder and whose argument this reader
      // cannot parse is COVERAGE LOST, the same verdict the matrix-expansion path
      // one branch up already reaches — so the third unparseable argument shape
      // stops the build instead of shrinking the domain.
      if (envs.length === 0) {
        if (text.includes(RECORD_SCRIPT)) {
          coverageLost([
            `${wf.rel ?? wf.file ?? '?'}:${jobName} runs \`${RECORD_SCRIPT}\` and this scan could not read the environment it records.`,
            'That job would leave [14]O-7\'s domain silently and the census below would print the smaller number as a',
            'pass — the exact way the web deploy job was lost in 2026-08-07 and the release job in 2026-08-26. Widen',
            '`RECORD_CALL` in tooling/ci/workflow-scan.mjs to read the new argument shape.',
          ]);
        }
        continue;
      }
      const smokes = (text.match(/post-deploy-smoke\.mjs/g) ?? []).length;
      for (const environment of new Set(envs)) {
        deployJobs.push({ workflow: wf.rel ?? wf.file ?? '?', job: jobName, environment, smokes });
      }
    }
  }

  // ⚠️ THE SURFACES WITH NO DEPLOY JOB AT ALL. Deriving the domain from
  // `record-deployment.mjs` calls alone would make DELETING a deploy job the way
  // to satisfy this check — the vacuous shape the cron limb above is written
  // against. `sites/nikatru` and `sites/rajasekarselvam` ship through Cloudflare
  // Git integration and [F-9] decided AGAINST migrating them into Actions, so
  // they have no job to add a step to and are covered by O-2's external prober
  // instead. That is a real answer and it has to be WRITTEN DOWN: each such site
  // must carry an exemption naming the covering mechanism, so a new site arrives
  // unclassified and red rather than unwatched and quiet.
  const sitesDir = join(ROOT, 'sites');
  if (existsSync(sitesDir)) {
    for (const e of listDir(sitesDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue;
      deployJobs.push({ workflow: `sites/${e.name}`, job: '(cloudflare git integration — no job)', environment: `site:${e.name}`, smokes: 0 });
    }
  }

  // ── [14]O-10 · the text of every file a row names as a freshness reader ───
  // Read here rather than in the pure half so the pure half stays testable with
  // fixture text, and so a reader that exists but watches a DIFFERENT workflow
  // is caught by content rather than by the existence of a path.
  const readerSource = new Map();
  for (const r of reg.rows ?? []) {
    for (const m of String(r?.mechanism?.readBy ?? '').matchAll(NAMED_PATH)) {
      const p = m[0];
      if (readerSource.has(p)) continue;
      try {
        readerSource.set(p, readFileSync(join(ROOT, p), 'utf8'));
      } catch {
        // Absent: `paths` already knows, and the pure half reports it.
      }
    }
  }

  const now = Date.now();
  const { errors, prints, stats, anchored } = evaluate(reg, { workflows, paths, deployJobs, readerSource }, now);

  // ── the OTHER direction: a duty row anchored at a workflow that is gone ───
  for (const [anchor, row] of anchored) {
    if (anchor.startsWith(`${WORKFLOW_DIR_REL}/`) && !workflows.includes(anchor.split('/').pop())) {
      coverageLost([
        `${row.id} anchors at ${anchor}, which is not among the ${workflows.length} workflow(s) on disk.`,
        'The register would keep asserting a duty performed by a mechanism that no longer exists — a stale row',
        'reads as coverage, which is strictly worse than an absent one.',
      ]);
    }
  }

  // ── cron duties ⊇ every wrangler cron ─────────────────────────────────────
  for (const cfg of cronConfigs) {
    const row = [...anchored.values()].find((r) => r.mechanism.anchor === cfg && r.mechanism.substrate === 'cloudflare-cron');
    if (!row) {
      errors.push(
        `${cfg} declares \`triggers.crons\` and has no \`duty\` row with \`mechanism.substrate: cloudflare-cron\` anchored at it. ` +
          'A scheduled job nothing enumerates is a job whose silence is unreadable — the state cron_heartbeat sat in for three red nights with zero readers.',
      );
    }
  }

  // ── THE OTHER DIRECTION for crons. Deleting `triggers.crons` from a wrangler
  //    config empties `cronConfigs`, and a loop over an empty set prints ok — the
  //    exact vacuous shape this guard exists to refuse. So a row that CLAIMS to
  //    be a cron duty must find its cron in the config it anchors.
  for (const row of anchored.values()) {
    if (row.mechanism.substrate !== 'cloudflare-cron') continue;
    if (!cronConfigs.includes(row.mechanism.anchor)) {
      coverageLost([
        `${row.id} declares \`substrate: cloudflare-cron\` and ${row.mechanism.anchor} declares no \`triggers.crons\`.`,
        'The register asserts a scheduled job that the config no longer schedules. Checking only the forward',
        'direction would make DELETING the cron the way to make this guard pass — a domain that shrinks to',
        'nothing while every remaining check still prints ok.',
      ]);
    }
  }

  // ── hostnames are DELEGATED, and the delegation is checkable ──────────────
  // Not "not checked here" — DELEGATED, which is only a different thing if the
  // target is verified to exist and to be non-empty. Otherwise "stage 11 owns
  // it" degrades into nobody owning it, silently, the moment that file moves.
  const delegated = reg._delegated?.hostnames;
  if (!nonEmpty(delegated)) {
    coverageLost([
      '`_delegated.hostnames` is missing. This register deliberately holds NO hostname rows, so without a',
      'named owner for that set the surfaces this factory serves are enumerated by nothing at all — which',
      'is exactly the state stage 14 was written to end, reached by deleting one line instead of many.',
    ]);
  }
  const delegatedPath = join(ROOT, delegated);
  if (!existsSync(delegatedPath)) {
    coverageLost([
      `\`_delegated.hostnames\` names ${delegated}, which does not exist.`,
      'Hostname coverage is [11]E-9\'s and is enforced by tooling/ci/assert-monitor-coverage.mjs against a',
      'strictly wider derivation than this file ever had. Deleting it must redden BOTH guards.',
    ]);
  }
  let hostCount = 0;
  try {
    const hosts = JSON.parse(readFileSync(delegatedPath, 'utf8'))?.hosts;
    if (!Array.isArray(hosts) || hosts.length === 0) throw new Error('no `hosts` array');
    hostCount = hosts.length;
  } catch (e) {
    coverageLost([
      `${delegated} could not be read as a host register (${e.message}).`,
      'An empty delegate is worse than none: this guard would report ok while the set it points at covers nothing.',
    ]);
  }
  // Both directions still matter, cheaply: the delegate must at least see every
  // custom domain this repo deploys. If it did not, "delegated" would be a
  // one-way pointer at a smaller set.
  {
    const delegatedHosts = new Set(
      (JSON.parse(readFileSync(delegatedPath, 'utf8')).hosts ?? []).map((h) => h.hostname),
    );
    for (const host of customDomains) {
      if (!delegatedHosts.has(host)) {
        errors.push(
          `\`${host}\` is a custom_domain route in a wrangler config and is not among the ${delegatedHosts.size} host(s) in ${delegated}. ` +
            'Hostname coverage is delegated there; a delegate that does not see a deployed surface is a pointer at a smaller set.',
        );
      }
    }
  }

  // ── rows ⊇ _requiredCoverage.ids (the half no tree walk can see) ──────────
  const ids = new Set(reg.rows.map((r) => r.id));
  const requiredIds = reg._requiredCoverage?.ids;
  if (!Array.isArray(requiredIds) || requiredIds.length === 0) {
    coverageLost([
      '`_requiredCoverage.ids` is empty or missing.',
      'It is the literal half of the domain — two registrars, the Origin CA cert, the Oracle box, the store',
      'enrolments, the laptop duties. Emptying it removes every external surface from the register at once',
      'while every remaining check still prints ok.',
    ]);
  }
  for (const id of requiredIds) {
    if (!ids.has(id)) {
      errors.push(`_requiredCoverage names \`${id}\` and no row has that id. This is the external half of the domain — the part the worst risks live in and no tree walk will ever reach.`);
    }
  }

  // ── THE DOMAIN FLOORS: an acceptance limb may not range over nothing ──────
  //
  // 🔴 Three of stage 14's criteria were green on 2026-08-06 for the SAME
  // reason, and it was not that any check was wrong: [14]O-3's cadence limb
  // queried no record, [14]O-11's lead-window arithmetic executed zero times
  // over twelve rows, and [14]O-17's deleting-job limb ranged over zero stores
  // out of nineteen. One defect, three times — an empty right-hand side rejects
  // nothing. The counts now PRINT on every run (above), and emptying a domain
  // entirely is COVERAGE LOST rather than a quieter pass.
  //
  // ⚠️ These are FLOORS ON THE DOMAIN, never on the register's size — the
  // distinction this file's header insists on. "At least twelve rows" is a
  // threshold somebody lowers; "at least one row of this kind, or the criterion
  // is checking nothing" is a statement about whether the check exists at all.
  if (stats.expiry.rows === 0) {
    coverageLost([
      'the register holds NO `expiring` row at all, so [14]O-11 ranges over the empty set.',
      'Two registrars, the Origin CA cert that expires with no notification, the Drive OAuth app and four',
      'store enrolments do not stop expiring because their rows were deleted — and every expiry check in',
      'this guard would report clean about nothing.',
    ]);
  }
  if (stats.retention.rows === 0) {
    coverageLost([
      'the register holds NO `retention` row at all, so [14]O-17 ranges over the empty set.',
      "The un-TTL'd nikatru-signups KV this requirement was written about does not stop holding contactable",
      'email addresses because its row was deleted.',
    ]);
  }

  // ── [14]O-3 · QUERY EVERY REACHABLE RUN RECORD ────────────────────────────
  // 🔴 STRUCTURAL, so it runs BEFORE the network limb: a timer target that no
  // dispatcher writes makes the D1 probe below range over zero rows, and the
  // answer it returns then reads as "never recorded" rather than "misconfigured".
  // Cheap, offline, and it is the check whose absence shipped a broken row.
  const dispatcherSrcPath = join(ROOT, DISPATCHER_SRC_REL);
  if (existsSync(dispatcherSrcPath)) {
    errors.push(...checkTimerTargetsAgainstDispatcher(reg, readFileSync(dispatcherSrcPath, 'utf8')));
  } else if ((reg.rows ?? []).some((r) => r?.mechanism?.recordQuery?.timer?.job === DISPATCH_JOB)) {
    coverageLost([
      `${DISPATCHER_SRC_REL} does not exist under ${ROOT}, and rows declare a \`${DISPATCH_JOB}\` timer.`,
      'Their target strings would go unverified, which is how the first one shipped pointing at nothing.',
    ]);
  }

  // ── [INV3] [INV4] · the unit every run-history row is judged by, held against
  //    the workflow file that declares it. STRUCTURAL, so it runs before a socket
  //    opens, and a register that fails it fails in every host.
  const allWorkflows = parseAllWorkflows(ROOT);
  const parsedByFile = new Map(allWorkflows.map((wf) => [String(wf.rel ?? '').split('/').pop(), wf]));
  // ⏱ 2026-09-09 — which workflow files declare `workflow_dispatch` (the trigger
  // half of the redness domain) and which lanes are self-gated on the check this
  // guard's own exit code decides. Both read from `.github/workflows`.
  const dispatchable = dispatchableWorkflows(ROOT);
  const topology = gateTopology(ROOT);
  const units = checkRunUnits(reg, parsedByFile, topology);
  errors.push(...units.errors);
  prints.push(...units.prints);
  // ⏱ 2026-09-23 — one reader's red may never silence another (see
  // `checkReaderIndependence`). STRUCTURAL, so it decides before a socket opens.
  const readerSteps = checkReaderIndependence(parsedByFile.get(READER_WORKFLOW) ?? null);
  errors.push(...readerSteps.errors);
  prints.push(...readerSteps.prints);
  if (readerSteps.lost) coverageLost(readerSteps.lost);
  const scopes = checkLiveVerdictScopes(reg, topology);
  errors.push(...scopes.errors);
  prints.push(...scopes.prints);
  // [INV1] [INV2] [INV5] — the host and the event come from the environment
  // GitHub sets, and the event is believed only from a host whose file declares it.
  const policy = hostPolicy(process.env, topology, workflowEventsByFile(allWorkflows));
  // ⏱ 2026-09-11 — `liveReadPlan`. Only an ADVISORY host asks git anything; an
  // enforcing host is handed `{ read: true }` without a spawn or a file read.
  const readPlan =
    policy.mode === 'advisory'
      ? liveReadPlan(
          policy,
          proposalChangedFiles(process.env, gitIn(ROOT)),
          liveReadInputs(reg, localImportClosure(GUARD_SCRIPT_REL, (rel) => readFileSync(join(SCRIPT_ROOT, rel), 'utf8'))),
        )
      : liveReadPlan(policy, null, null);

  // Last, because these are the only limbs that leave this machine, and
  // everything structural should already have decided by the time a socket opens.
  const jobsCache = new Map();
  const recordProbes = readPlan.read ? await probeRunRecords(reg, ROOT, parsedByFile, jobsCache) : LIVE_READS_NOT_MADE;
  const rec = evaluateRunRecords(reg, recordProbes, now);
  if (rec.coverageLost) coverageLost(rec.coverageLost);
  prints.push(...(rec.prints ?? []));

  // [14]O-3b asks a DIFFERENT question of the same record — not "is the newest
  // success recent" but "is the newest FAILURE newer than it". See its header.
  const postGate = postGateAdmission(parsedByFile, topology);
  const redProbes = readPlan.read ? await probeRedSince(reg, dispatchable, parsedByFile, jobsCache, postGate) : LIVE_READS_NOT_MADE;
  const red = evaluateRedSince(reg, redProbes, dispatchable, postGate);
  prints.push(...(red.prints ?? []));
  if (red.coverageLost) {
    for (const p of prints) console.log(`⬜  ${p}`);
    coverageLost(red.coverageLost);
  }

  // ── ONE ROUTER FOR EVERY LIVE VERDICT (INV1, INV2, INV4) ─────────────────
  // Both limbs hand back their verdict lines in `errors` AND in `live`. What is
  // live is routed by the host policy; what is not is structural and blocks in
  // every host; what is a measurement failure is COVERAGE LOST (INV6).
  const live = [...(rec.live ?? []), ...(red.live ?? [])];
  const liveLines = new Set(live.map((v) => v.line));
  const measurement = [...(rec.measurement ?? [])];
  const measured = new Set(measurement);
  for (const e of [...(rec.errors ?? []), ...(red.errors ?? [])]) {
    if (!liveLines.has(e) && !measured.has(e)) errors.push(e);
  }
  const dark = readPlan.read ? githubDarkness(redProbes) : null;
  if (dark) measurement.push(dark);
  const routed = routeLiveVerdicts(live, policy, topology, reg, parsedByFile);

  // ── report ────────────────────────────────────────────────────────────────
  for (const p of prints) console.log(`⬜  ${p}`);
  console.log(
    `⬜  register: ${stats.rows} rows · ${stats.onDemand} on-demand · ${stats.cannotRevert} cannot-revert · ` +
      `${stats.unverified} unverified · ${stats.datedTripwires} dated tripwire(s) armed · ` +
      `${stats.unverifiableAnchors} anchored outside the CI checkout — ${OUTSIDE_CI.join(' or ')} (this guard CANNOT verify those anchors exist)`,
  );
  // ⬜ [14]O-4's gaps print IN FULL and SEPARATELY from the row-level ones. They
  // are a different question — "if this stops, does anything anywhere notice" —
  // and folding them into the general owner-gated list is how the answer stopped
  // being asked. Never blocking (CLAUDE.md C-6): every one of these needs a
  // vendor console, a second provider, or a machine no workflow can reach.
  const abs = stats.absence;
  if (abs.gaps.length) {
    console.log(
      `⬜  ${abs.gaps.length} SCHEDULED DUTY(IES) WHOSE ABSENCE NOTHING OFF-HOST WOULD NOTICE — printed every run, ` +
        'never blocking (CLAUDE.md C-6). A duty that ceases produces no signal at all, and no signal is ' +
        'byte-identical to a portfolio with nothing wrong [pipeline O-4]:',
    );
    for (const g of abs.gaps) console.log(`      · ${g}`);
  }
  if (stats.gaps.length) {
    console.log(`⬜  ${stats.gaps.length} OWNER-GATED gap(s) — printed every run, never blocking (CLAUDE.md C-6):`);
    for (const g of stats.gaps) console.log(`      · ${g}`);
  }

  // The policy and the derivation it rests on are printed on EVERY run, red or
  // green: an exemption nobody can see is a waiver, and a shrink nobody can see
  // is the defect.
  console.log(`⬜  [INV1/INV2] HOST POLICY — ${policy.mode.toUpperCase()}: ${policy.why}`);
  if (readPlan.line) console.log(`⬜  ${readPlan.line}`);
  console.log(
    `⬜  [INV4] GATE TOPOLOGY: gate check \`${topology?.gateName ?? 'UNKNOWN'}\` is produced by ` +
      `\`${topology?.gateWorkflow ?? 'UNKNOWN'}\` · SELF-GATED (they run \`${GATE_SCRIPT_REL}\`, so a dispatch of ` +
      `theirs aborts while that check is red): ${[...(topology?.selfGated ?? [])].sort().join(' · ') || 'NONE DERIVED'} · ` +
      `GUARD HOSTS (they run \`${GUARD_SCRIPT_REL}\`, so this guard helps produce their conclusion): ` +
      `${[...(topology?.guardHosts ?? [])].sort().join(' · ') || 'NONE DERIVED'} · THIS RUN'S HOST: ${policy.host ?? 'none resolved'}`,
  );
  for (const l of topology?.why ?? []) {
    console.log(
      `⬜  [INV4] 🔴 GATE TOPOLOGY INCOMPLETE · ${l}. Nothing is exempted on an incomplete derivation: every live ` +
        'verdict in an enforcing host BLOCKS. Fail-closed is deliberate — an exemption is granted only on proof, never on a missing answer.',
    );
  }
  for (const n of routed.notes) console.log(`⬜  ${n}`);
  console.log(
    `⬜  [LIVE] ${live.length} live verdict(s) about the state of the world on this run: ${routed.blocking.length} ` +
      `BLOCKING in this host · ${routed.printed.length} FAILING and PRINTED, not blocking — each is listed in full`,
  );
  for (const v of routed.printed) {
    console.log(`⬜  [LIVE] 🔴 FAILING, NOT BLOCKING IN THIS HOST — ${v.line}`);
    console.log(`⬜  [LIVE]    …WHY IT DOES NOT BLOCK HERE: ${v.why}`);
  }

  if (measurement.length) {
    console.error(
      `✗ COVERAGE LOST — ${measurement.length} measurement failure(s): this runner could not read enough of the world ` +
        'to grade it, and "could not look" is never a pass and never a finding (INV6):',
    );
    for (const m of measurement) console.error(`      ${m}`);
  }
  const problems = [...errors, ...routed.blocking.map((v) => v.line)];
  if (problems.length) {
    console.error(`✗ ${REGISTER_REL} — ${problems.length} problem(s):`);
    for (const e of problems) console.error(`    ${e}`);
  }
  // 2 beats 1 beats 0: an unread record outranks a bad one (INV6).
  if (measurement.length || routed.blocking.some((v) => v.code === 2)) {
    process.exitCode = 2;
    return;
  }
  if (problems.length) {
    process.exitCode = 1;
    return;
  }

  console.log(
    `ok  operations register — ${stats.rows} rows; ${workflows.length} workflow(s) and ${cronConfigs.length} cron config(s) all classified; ` +
      `${requiredIds.length} external ids present; ${customDomains.length} custom domain(s) delegated to ${delegated} (${hostCount} hosts) [pipeline O-1]`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE STALE PAGE BOTH READS AGREE ON — the anchor. Added 2026-09-18,
// coverage unit `stale-run-page` (the same unit reconcileRunReads opened).
//
// reconcileRunReads above refuses when the two widths DISAGREE. On 2026-09-18
// ops-watch run 35369631763 was served the SAME stale page at both widths —
// ops-watch.yml's newest scheduled success read as run 33228655039 of
// 2026-08-29 while three newer ones existed — so both reads agreed, the page
// was believed, and three step-level duties read "NO SUCCESSFUL RUN AT ALL".
// Agreement between two reads of one replica is not evidence. So every shared
// branch page must now also satisfy an ANCHOR it cannot satisfy when stale —
// the self-run, branch-head and cross-read anchors in run-page-anchor.mjs,
// which carries the measurements and the one named residue. A violated anchor
// THROWS, and a throw here is `unreadable` at every call site, exactly as a
// disagreement already was: printed, never a pass, never a red.
//
// It is appended at the end of the file ON PURPOSE: branchPage above changed
// by exactly one line, so every `assert-ops-register.mjs:NNN` citation in the
// corpus still lands where it did.
// ─────────────────────────────────────────────────────────────────────────────
import { judgeRunPage, selfRunFloor, headAnchor, pushTriggersBranch, needsCrossRead } from './run-page-anchor.mjs';

/** Per-process caches — ONE branch HEAD read and ONE repository-wide run page
 *  per branch per guard run, whatever the number of workflows. */
const BRANCH_HEADS = new Map();
const REPO_RUN_PAGES = new Map();

/** The real I/O the anchor needs; a test hands in its own. */
function anchorIo() {
  return {
    env: process.env,
    nowMs: Date.now(),
    readWorkflow: (file) => {
      const p = join(ROOT, '.github', 'workflows', file);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    },
    branchHead: (repo, branch) => {
      const key = `${repo}|${branch}`;
      if (!BRANCH_HEADS.has(key)) BRANCH_HEADS.set(key, ghJson(`/repos/${repo}/commits/${encodeURIComponent(branch)}`));
      return BRANCH_HEADS.get(key);
    },
    repoRunsPage: (repo, branch) => {
      const key = `${repo}|${branch ?? ''}`;
      if (!REPO_RUN_PAGES.has(key)) {
        const br = branch ? `branch=${encodeURIComponent(branch)}&` : '';
        REPO_RUN_PAGES.set(key, ghJson(`/repos/${repo}/actions/runs?${br}per_page=100`));
      }
      return REPO_RUN_PAGES.get(key);
    },
  };
}

/** Applies the anchors to one cross-checked branch page. Returns the page
 *  unchanged when every anchor that applies holds; THROWS `stale page — …`
 *  when one does not. Exported so the measured stale page is a test case. */
export async function anchoredBranchPage(repo, workflow, branch, runs, pageFull, io = anchorIo()) {
  const what = `the run history of ${workflow}${branch ? ` on ${branch}` : ''}`;
  const floor = selfRunFloor(io.env, { repo, workflow, branch });
  let head = null;
  if (branch && pushTriggersBranch(io.readWorkflow(workflow), branch)) {
    head = headAnchor(await io.branchHead(repo, branch), io.nowMs, branch);
  }
  let cross = null;
  // THE CROSS-READ, AT REPOSITORY GRAIN. It is the weakest anchor, so it is
  // spent only on a page no stronger anchor holds — and it is ONE request per
  // branch for the whole guard run, not one per workflow: the repository-wide
  // run list (a different endpoint from the per-workflow one, so a different
  // cache key and index), filtered here by `path`. Measured on the 2026-09-11
  // replay, a per-workflow cross-read cost 7 requests and broke this guard's
  // request ceiling; this costs 1. Its window is the newest 100 runs on the
  // branch (~33h on main, measured 2026-09-18), which is ample for the pages
  // it exists for — a page days or weeks behind. One-way, like every cross-read:
  // a run it does not hold can never make a page stale.
  if (!floor && !head && needsCrossRead(runs, io.nowMs)) {
    const body = await io.repoRunsPage(repo, branch);
    if (!Array.isArray(body?.workflow_runs)) throw new Error(`the repository-wide run list${branch ? ` on ${branch}` : ''} came back without a workflow_runs array`);
    const path = `.github/workflows/${workflow}`;
    cross = { runs: body.workflow_runs.filter((r) => r?.path === path), why: `the repository-wide run list${branch ? ` on ${branch}` : ''}` };
  }
  const verdict = judgeRunPage(runs, { what, floor, head, cross, nowMs: io.nowMs });
  if (!verdict.ok) throw new Error(verdict.why);
  return { runs, pageFull };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  // 🔴 An unhandled rejection in a guard exits 0 on some Node versions and 1 on
  // others, so the failure path is explicit. `process.exitCode`, never
  // `process.exit()`: exiting while a fetch handle is still closing aborts Node on
  // Windows with 127 for EVERY outcome (tooling/ci/assert-gate-passed.mjs records
  // it). A guard that throws rendered no verdict at all, which is COVERAGE LOST (INV6).
  main().catch((e) => {
    if (e instanceof GuardExit) {
      process.exitCode = e.code;
      return;
    }
    console.error(`✗ COVERAGE LOST — ${REGISTER_REL}: the guard itself threw, so nothing printed above is a verdict (INV6): ${e?.stack ?? e}`);
    process.exitCode = 2;
  });
}
