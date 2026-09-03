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
// Usage:  node tooling/ci/assert-ops-register.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
// The ONE workflow parser. Four copies of it drift in the way that reports
// "clean" — which lines they can see — so [14]O-7's deploy-job derivation goes
// through the same one assert-release-provenance and assert-no-secret-defines use.
import { parseAllWorkflows, RECORD_CALL, expandMatrixEnvironment } from './workflow-scan.mjs';
// The ONE comment tokenizer, for the same reason as the workflow parser above.
import { stripSourceComments } from './text-reductions.mjs';

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
const NAMED_PATH = /(?<![\w/.-])(?:tooling|\.github|services|sites|packages|apps|scripts)\/[A-Za-z0-9_.\-/]*[A-Za-z0-9_-]\.(?:mjs|js|ts|yml|yaml|json|jsonc|sql|ps1|dart|py)\b/g;

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

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

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

const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
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
// ── WHY 1.5x THE CADENCE ────────────────────────────────────────────────────
// Not chosen here: it is `check-heartbeats.mjs`'s own ratio, and its reasoning
// is the register's — a window EQUAL to the cadence has zero margin, so one late
// run reads as a dead duty and the guard gets disabled. One missed run is not an
// alarm; two are. The number lives in `_recordReaders._windowMultiplier` so it
// is stated once and can be read by a human without reading this file.
// ─────────────────────────────────────────────────────────────────────────────

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

  const windowMs = days * 86_400_000 * multiplier;
  const windowLabel = `${row.cadence} x ${multiplier} = ${(days * multiplier * 24).toFixed(1)}h`;

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
    if (q.firstDue !== undefined) {
      const dueMs = typeof q.firstDue === 'string' ? Date.parse(q.firstDue) : NaN;
      const days = cadenceDays(r.cadence);
      const mult = decl._windowMultiplier;
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

  const tally = { pass: 0, fail: 0, unreadable: 0, unreachable: 0 };
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
    if (c.verdict === 'fail') (c.gated ? gatedFailLines : errors).push(c.line);
    else if (c.verdict === 'unreachable') unreachableLines.push(c.line);
    else if (c.verdict === 'unreadable') unreadableLines.push(c.line);
    else if (c.verdict === 'pass') prints.push(`[14]O-3 — ${c.line}`);
  }

  if (tally.unreadable > readCap) {
    errors.push(
      `${tally.unreadable} scheduled duty(ies) went UNREADABLE on this runner and the ceiling is ${readCap}. ` +
        'Unreadable is "could not tell", never "it is fine" — above this line the limb has read too little of ' +
        'its own domain to be believed about the rest. Ratchets DOWN as credentials and platforms arrive.',
    );
  }

  // 🔴 THE NUMBER THAT MUST NEVER BE INVISIBLE. `0 queried` and `4 queried` read
  // identically in a wall of prints unless the count is stated, and "queried 0
  // records" is precisely the state that was green for a day and a half.
  prints.push(
    `[14]O-3 — ${scheduled.length} scheduled duty(ies) · ${tally.pass} record(s) QUERIED and inside window · ` +
      `${tally.fail} FAILING (${gatedFailLines.length} of them OWNER-GATED: printed, not blocking) · ` +
      `${tally.unreadable} reader(s) unreadable on this runner (ceiling ${readCap}) · ` +
      `${tally.unreachable} declared unreachable (ceiling ${cap})`,
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

  return { errors, prints, stats: { scheduled: scheduled.length, ...tally, gatedFail: gatedFailLines.length } };
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
  const list = names.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',');
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
async function probeGithubRun(q, repo) {
  const ev = q.event ? `event=${encodeURIComponent(q.event)}&` : '';
  const body = await ghJson(`/repos/${repo}/actions/workflows/${encodeURIComponent(q.workflow)}/runs?${ev}status=success&per_page=1`);
  const newest = body?.workflow_runs?.[0];
  if (!newest) {
    return {
      lastSuccessMs: NaN,
      detail: `${repo} has NO successful \`${q.event ?? 'any'}\` run of ${q.workflow} in its run history at all.`,
    };
  }
  return {
    lastSuccessMs: Date.parse(newest.updated_at),
    detail: `run ${newest.id} (${q.event ?? 'any'}) succeeded at ${newest.updated_at}.`,
  };
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
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql: `SELECT job, MAX(ran_at) AS ran_at FROM ${q.table} WHERE ok = 1 GROUP BY job` }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`the D1 API returned ${res.status}`);
  const body = await res.json();
  if (body?.success !== true) throw new Error(`the D1 API reported failure: ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`);
  const rows = body?.result?.[0]?.results ?? [];
  if (rows.length === 0) return { lastSuccessMs: NaN, detail: `${q.table} holds no row with ok = 1 for any job.` };
  // The OLDEST of the per-job newest successes: one silent job inside a cron
  // that runs several is exactly the [4]B-11 finding (half the cron invisible),
  // so the duty is only as fresh as its stalest watched job.
  const stalest = rows.reduce((a, b) => (Date.parse(a.ran_at) <= Date.parse(b.ran_at) ? a : b));
  return {
    lastSuccessMs: Date.parse(stalest.ran_at),
    detail: `${rows.length} job(s) with an ok = 1 row; the STALEST is \`${stalest.job}\` at ${stalest.ran_at}.`,
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

async function probeRunRecords(reg, root) {
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
        probes.set(r.id, q.reader === 'github-run-history' ? await probeGithubRun(q, repo) : await probeGithubIssue(q, repo));
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
  const { found: wranglers, excluded } = findWranglerConfigs(ROOT);
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
  // Last, because it is the only limb that leaves this machine, and everything
  // structural should already have decided by the time a socket is opened.
  const recordProbes = await probeRunRecords(reg, ROOT);
  const rec = evaluateRunRecords(reg, recordProbes, now);
  if (rec.coverageLost) coverageLost(rec.coverageLost);
  errors.push(...(rec.errors ?? []));
  prints.push(...(rec.prints ?? []));

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

  if (errors.length) {
    console.error(`✗ ${REGISTER_REL} — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`    ${e}`);
    process.exit(1);
  }

  console.log(
    `ok  operations register — ${stats.rows} rows; ${workflows.length} workflow(s) and ${cronConfigs.length} cron config(s) all classified; ` +
      `${requiredIds.length} external ids present; ${customDomains.length} custom domain(s) delegated to ${delegated} (${hostCount} hosts) [pipeline O-1]`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  // 🔴 An unhandled rejection in a guard exits 0 on some Node versions and 1 on
  // others. A guard whose exit code depends on the runtime is a guard that can
  // report clean by accident, so the failure path is explicit here.
  main().catch((e) => {
    console.error(`✗ ${REGISTER_REL} — the guard itself threw: ${e?.stack ?? e}`);
    process.exit(1);
  });
}
