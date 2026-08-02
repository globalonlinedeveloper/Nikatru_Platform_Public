#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-app-dod.mjs — [pipeline N-2 · N-3 · N-5 · N-8 · N-9] the keystone of
// stage 6: "is app X done?" becomes a query against a record instead of a memory.
//
// THE DEFECT CLASS THIS EXISTS FOR. The factory's one live app shipped a settings
// row reading "· Pro plan" with no entitlement behind it, a notifications screen
// rendering hardcoded fixtures, and a delete-account button whose entire effect
// was closing its own dialog. Every one rendered, analyzed clean and passed the
// suite, because nothing anywhere defined what an app's own features must DO
// before the app may claim completion. All three were fixed by hand; exactly one
// produced a standing guard, and that guard reads the brick path only.
//
// ── WHAT MAKES THIS GUARD ABLE TO FAIL, WHICH IS THE WHOLE PROBLEM ───────────
//
// 🔴 THE DOMAIN. The stage doc says "every app under `apps/`", with `apps/subly`
// exempt by name as the frozen rail-prover (39-CHASSIS §4 cut 1). `apps/` holds
// exactly one app, so that set is EMPTY and "every app has a done-record" is
// vacuously true — seven requirements rest on it. Two changes fix it:
//
//   1. The domain is the root `pubspec.yaml` `workspace:` list, NEVER a directory
//      listing. A listing differs between this box and CI; the workspace block is
//      a maintained field the stamper itself writes (`post_gen.dart`
//      `_registerInWorkspace` appends `apps/<id>` on every stamp).
//   2. This guard RUNS IN THE `app_brick` LANE, after the stamp. That lane stamps
//      a throwaway `apps/probe` on every push and leaves it registered, so stage 6
//      has a real, non-exempt, freshly stamped app to quantify over on every push
//      — starting today, instead of waiting for app #2.
//
// And when the non-exempt count is 0 the answer is `COVERAGE LOST`, not `ok`.
//
// 🔴 THE LIFECYCLE FIELD, AND THE ANCHOR THAT STOPS IT BEING AN EXCUSE. A freshly
// stamped probe has no features of its own, no human sign-off and no selection
// record, so `status: "stamped"` enforces shape + the mechanical rows, and
// `status: "claiming-done"` enforces everything. A lifecycle field is itself a
// vacuity risk — if `stamped` never has to become `claiming-done`, the deferred
// clauses are quantifying over ∅ under a new name. The falsifiable anchor is
// cross-tree: an app whose row in `sites/_shared/_data/apps.json` says
// `"status": "live"` while its `dod.json` still says `stamped` FAILS. That is a
// red somebody can produce today, and if it is ever dropped the whole lifecycle
// idea must be dropped with it.
//
// 🔴 PRESENCE IS NOT ENFORCEMENT (N-3). The drafted criterion accepted a check
// "present in tooling/ci/ OR ci.yml", which a guard file nobody runs satisfies —
// the exact opposite of "runs on every push" — and which a COMMENT satisfies too,
// in a file full of long explanatory comment blocks. So a register row's `check`
// must resolve to a `run:` step on a NON-COMMENT line, in a workflow whose `on:`
// includes `push`, whose job appears in `ci-gate`'s `needs:` list. That last
// clause is what makes "runs per push" mean "can fail the merge": `ci-gate` is
// the required check on protected `main`, so a lane outside its `needs` can go
// red while the merge goes through.
//
// ⚠️ THERE IS DELIBERATELY NO `e2e.yml` EXCEPTION HERE, though the stage doc names
// one. An exception nothing reaches is an unreachable branch, and by this repo's
// own rule an assertion that cannot fail is worse than none because it inflates
// apparent coverage. Add it WITH the row that needs it.
//
// 🔄 UPDATED 2026-08-02. The parenthetical this note used to carry — "N-6's
// freshness clause is not built (the nightly E2E has failed on every scheduled
// run since 2026-07-26, so landing a freshness guard would block every merge on
// a pre-existing defect)" — is now STALE and would have been read as current.
// N-6's freshness and leg-coverage clauses shipped as
// `assert-e2e-proof-fresh.mjs` and `assert-e2e-legs.mjs`, both wired into
// `ci.yml`. The CONCLUSION is unchanged and the exception still must not exist:
// those two guards run in `ci.yml` like every other, so no register row is
// enforced by `e2e.yml` even now.
//
// 🔴 RESOLVE, DO NOT MATCH (N-5). A feature row naming a test is satisfied by that
// string appearing anywhere — in a comment, in a TODO, in the spec — and by
// `test('name', () {});` with an empty body. This repo has already shipped a
// scanner that counted a name inside a comment. So each row's test must resolve
// to a `test('…'` / `testWidgets('…'` DECLARATION on a non-comment line with a
// NON-EMPTY BODY, in a file the app's own test lane runs; each row also carries
// the `file:symbol` of the effect it asserts, so a hollow test left behind after
// the implementation is deleted still goes red; and the mutation record is DATED
// and expires against the implementation's own last commit. That is what turns
// "proven once in a terminal" into a state.
//
// ⚠️ SHALLOW CLONES ARE COVERAGE LOST, NOT A SKIP. The mutation-staleness check
// compares each row's date against `git log -1` for the implementation file. On a
// `fetch-depth: 1` checkout there is exactly one commit, dated at checkout time,
// so every row would read as stale — or, if the failure were softened to a print,
// the check would silently stop checking. The lane must check out with
// `fetch-depth: 0`; removing it turns this guard RED rather than quietly hollow.
//
// 🔴 WHAT CI CANNOT SEE, IT PRINTS (N-9). The selection record lives in
// `company/`, which is gitignored — CI can assert that a link's FIELDS are there;
// it can never assert the link RESOLVES. The stage doc's "the link is checkable
// even though the judgment is not" is false as written. So CI checks the four
// fields it can see and PRINTS the unverifiable half on every run;
// `tooling/scripts/check-selection-record.mjs` verifies the sha256 locally, where
// both trees are readable. Silence about an unperformed check is how apparent
// coverage inflates.
//
// ⚠️ STATED LIMIT, so nobody reads this as more than it is: `apps/probe` is a
// FEATURELESS stamped app. N-2, N-3 and the register↔invocation relationship
// exercise fully against it; the `claiming-done` clauses (human verdicts,
// selection fields) have no real instance in the tree and are exercised by
// fixture only. The passing line says so out loud, every run.
//
// Usage:  node tooling/ci/assert-app-dod.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** 39-CHASSIS §4 cut 1: `apps/subly` is a FROZEN legacy rail-prover. It predates
 *  the brick, was never stamped, and is never retrofitted — so it is exempt from
 *  carrying a done-record. Exempt BY NAME, never by a pattern, so adding an app
 *  can never accidentally exempt it. */
const EXEMPT = new Set(['apps/subly']);

/** The brick's own copy of a stamped app's tree. A freshly stamped app is
 *  UNTRACKED, so `git log` can say nothing about its files; the brick source it
 *  was rendered from IS tracked, and it is the same code. That is what lets the
 *  mutation-staleness clause run against the probe on every push instead of
 *  printing could-not-establish forever. */
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

const REGISTER_REL = 'tooling/dod-register.json';
const AGGREGATOR = 'ci-gate';

const problems = [];
const fail = (m) => problems.push(m);

const abs = (rel) => join(ROOT, rel);
const read = (rel) => readFileSync(abs(rel), 'utf8');
const has = (rel) => existsSync(abs(rel));

/** Structural failure. Everything below quantifies over what just went missing,
 *  so continuing would print a clean sweep of nothing. */
function coverageLost(lines) {
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-app-dod: FAILED');
  process.exit(1);
}

// ── Dart source helpers. BOTH are LENGTH-PRESERVING on purpose: the declaration
//    is found in the comment-stripped text (the test NAME is a string literal, so
//    strings must survive) and the body is brace-matched in the string-blanked
//    text (a brace inside a string is not a brace). Same indices, two views.
function stripDartComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') {
          depth--; out[i] = ' '; out[i + 1] = ' '; i += 2;
          if (depth === 0) break;
          continue;
        }
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Blanks the CONTENTS of string literals, keeping the quotes and the length. */
function blankDartStrings(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { out[j] = ' '; out[j + 1] = ' '; j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') { j++; break; }
        if (src[j] !== '\n') out[j] = ' ';
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

// ── workflow parsing. Comments stripped FULL-LINE AND TRAILING, because the two
//    parsers already in this tree diverged on exactly that once and an
//    inline-commented job escaped a check that way.
function parseWorkflow(rel) {
  const raw = read(rel);
  const stripped = raw.replace(/^\s*#.*$/gm, '').replace(/\s#.*$/gm, '');
  const lines = stripped.split('\n');
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = new Map();
  if (jobsAt !== -1) {
    let current = null;
    for (let i = jobsAt + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\S/.test(line)) break;
      const m = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
      if (m) { current = m[1]; jobs.set(current, []); }
      else if (current !== null) jobs.get(current).push(line);
    }
  }
  // `on:` — flow form (`on: [push]`) or block form with indented event keys.
  const events = new Set();
  const onFlow = stripped.match(/^on:\s*\[([^\]]*)\]/m);
  if (onFlow) for (const e of onFlow[1].split(',')) events.add(e.trim());
  const onAt = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (onAt !== -1) {
    for (let i = onAt + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break;
      const m = lines[i].match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):/);
      if (m) events.add(m[1]);
    }
  }
  return { rel, jobs, events, stripped, rawTopLevel: (raw.match(/^[a-z]+:/gm) ?? []).length };
}

/** `needs:` in either flow (`[a, b]`) or block (`- a`) form. */
function jobNeeds(body) {
  const flow = body.match(/^ {4}needs:\s*\[([^\]]*)\]/m);
  if (flow) return flow[1].split(',').map((s) => s.trim()).filter(Boolean);
  const lines = body.split('\n');
  const at = lines.findIndex((l) => /^ {4}needs:\s*$/.test(l));
  if (at === -1) return [];
  const out = [];
  for (const line of lines.slice(at + 1)) {
    const m = line.match(/^\s*-\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

/** The `run:` text of every step of one job, concatenated. Only `run:` bodies —
 *  a name, a `with:` value or (once comments are gone) any other key is not an
 *  invocation, and reading the whole job body would put us back to matching prose. */
function jobRunText(bodyLines) {
  const at = bodyLines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (at === -1) return '';
  const blocks = [];
  for (const line of bodyLines.slice(at + 1)) {
    if (line.trim() === '') { if (blocks.length) blocks[blocks.length - 1].push(line); continue; }
    const indent = line.search(/\S/);
    if (indent < 6) break;
    if (/^ {6}-/.test(line)) blocks.push([line.replace(/^( {6})-\s?/, '$1  ')]);
    else if (blocks.length) blocks[blocks.length - 1].push(line);
  }
  let all = '';
  for (const block of blocks) {
    const runAt = block.findIndex((l) => /^ {8}run:/.test(l));
    if (runAt === -1) continue;
    const rest = block[runAt].replace(/^ {8}run:\s*/, '');
    if (rest !== '' && !/^[|>]/.test(rest)) { all += `${rest}\n`; continue; }
    for (const l of block.slice(runAt + 1)) {
      if (l.trim() === '') continue;
      if (l.search(/\S/) <= 8) break;
      all += `${l}\n`;
    }
  }
  return all;
}

// ═════ 0 · THE DOMAIN ════════════════════════════════════════════════════════
if (!has('pubspec.yaml')) {
  coverageLost([
    'the root pubspec.yaml does not exist, so the domain of apps could not be read at all.',
    'The workspace block is deliberately the domain instead of a directory listing — a listing',
    'differs between this box and CI, and a domain that depends on which machine reads it is not one.',
  ]);
}
const pubspec = read('pubspec.yaml').replace(/^\s*#.*$/gm, '');
const wsLines = pubspec.split('\n');
const wsAt = wsLines.findIndex((l) => /^workspace:\s*$/.test(l));
if (wsAt === -1) {
  coverageLost([
    'the root pubspec.yaml has no `workspace:` block.',
    'That block IS the domain of this guard, and the stamper writes to it on every stamp',
    '(post_gen.dart `_registerInWorkspace`). Without it every app below is quantified over nothing.',
  ]);
}
const members = [];
for (const line of wsLines.slice(wsAt + 1)) {
  if (/^\S/.test(line)) break;
  const m = line.match(/^\s*-\s*(\S+)\s*$/);
  if (m) members.push(m[1]);
}
if (members.length === 0) {
  coverageLost([
    'the root pubspec.yaml `workspace:` block lists no members.',
    'The domain is empty for a structural reason, not because there are no apps.',
  ]);
}
const appMembers = members.filter((m) => m.startsWith('apps/'));
const stampedApps = appMembers.filter((m) => !EXEMPT.has(m));

// 🔴 THE BRICK IS ALWAYS IN THE DOMAIN, and that is what stops this guard being
// vacuous on a clean checkout. `apps/` holds exactly one app and the freeze
// exempts it by name, so the stamped-app set is EMPTY except inside the
// `app_brick` lane — the identical hole `assert-stamp-properties.mjs` had from the
// other side, where it read the brick and never `apps/`. Reading BOTH is one
// contract: the template every app is born from, plus every app that exists.
//
// The brick's own copy is a real subject, not a stand-in — its test files, its
// implementation files and its git history are all tracked, so every clause below
// (including the mutation-staleness one, which needs `git log`) runs against it on
// every push, in a lane that has no stamp at all.
const domain = [BRICK_APP, ...stampedApps];
if (!has(`${BRICK_APP}/dod.json`)) {
  coverageLost([
    `${BRICK_APP}/dod.json does not exist.`,
    'Every app is stamped from this template, so a missing seed record means every app from here on is',
    'born without one — and on a clean checkout it is also the ONLY subject in this guard\'s domain',
    '(apps/ holds one app and the freeze exempts it by name), so its absence would leave the whole',
    'guard quantifying over nothing.',
  ]);
}

/** Passed by the `app_brick` lane ONLY. There, a stamp has just run and post_gen
 *  has appended `apps/<id>` to the workspace block, so zero non-exempt apps means
 *  the stamp or the registration regressed — and checking only the brick would
 *  hide it. Outside that lane the honest count is printed, not failed. */
const requireStamped = process.argv.includes('--require-stamped');
if (requireStamped && stampedApps.length === 0) {
  coverageLost([
    'invoked with --require-stamped and the workspace lists no non-exempt app member ' +
      `(app members: ${appMembers.length}, exempt: ${[...EXEMPT].join(', ')}).`,
    'This flag is passed by the `app_brick` lane, immediately after a stamp that registers `apps/probe`',
    'in the root pubspec. Zero here means the stamp did not happen, the workspace registration',
    'regressed, or this step moved after the revert — and in every one of those cases the freshly',
    'stamped app this stage exists to check would silently not have been checked.',
  ]);
}

// ═════ 1 · THE REGISTER, AND WHETHER ITS CHECKS REALLY RUN (N-1 · N-3) ═══════
if (!has(REGISTER_REL)) {
  coverageLost([
    `${REGISTER_REL} does not exist.`,
    'It is the machine-readable half of the Definition of Done and the right-hand side of every',
    'per-app comparison below; without it each app record would be compared against nothing.',
  ]);
}
let register;
try {
  register = JSON.parse(read(REGISTER_REL));
} catch (e) {
  coverageLost([`${REGISTER_REL} could not be parsed (${e.message}).`]);
}
const items = Array.isArray(register.items) ? register.items : [];
const humanRows = Array.isArray(register.humanReviewRows) ? register.humanReviewRows : [];
if (items.length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no items.`,
    'Every per-app set comparison below is against this list; over an empty list they are all vacuously',
    'true — which is precisely how an empty file satisfied the original N-1.',
  ]);
}
if (humanRows.length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no \`humanReviewRows\`.`,
    'N-8 fails an app whose human section is incomplete, and "incomplete" is measured against this list.',
    'Empty means `humanReview: []` has no missing rows and passes — the defect N-8 exists to remove.',
  ]);
}

const ci = parseWorkflow('.github/workflows/ci.yml');
if (ci.rawTopLevel > 0 && ci.jobs.size === 0) {
  coverageLost([
    'ci.yml has top-level keys and ZERO parsed jobs — the workflow parser has stopped reaching it.',
    'Every "does this check really run" question below would be asked of an empty map and pass.',
  ]);
}
if (!ci.jobs.has(AGGREGATOR)) {
  coverageLost([
    `ci.yml declares [${[...ci.jobs.keys()].join(', ')}] and none of them is "${AGGREGATOR}".`,
    'That job is the required check on protected main; "runs per push" means "is needed by it".',
  ]);
}
const gateNeeds = new Set(jobNeeds(ci.jobs.get(AGGREGATOR).join('\n')));
if (gateNeeds.size === 0) {
  coverageLost([
    `ci.yml's "${AGGREGATOR}" job has an empty or unparseable \`needs:\` list.`,
    'Every mechanical register row is checked against that list; empty means every lane looks unwired',
    'and — worse if the test were inverted — that nothing is required to pass before a merge.',
  ]);
}

// Every tracked workflow, so a guard wired somewhere other than ci.yml still
// resolves — but only the ones whose `on:` includes push can satisfy N-3.
const wfDir = join(ROOT, '.github', 'workflows');
if (!existsSync(wfDir)) {
  coverageLost(['.github/workflows does not exist, so no register row could be resolved to an invocation.']);
}
const workflows = readdirSync(wfDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => parseWorkflow(`.github/workflows/${f}`));

const guardDir = join(ROOT, 'tooling', 'ci');
const guardFiles = new Set(existsSync(guardDir) ? readdirSync(guardDir).filter((f) => f.endsWith('.mjs')) : []);
if (guardFiles.size === 0) {
  coverageLost(['tooling/ci holds no .mjs guard files, so every `guard` row below would fail for the wrong reason.']);
}

let mechanical = 0;
let humanItems = 0;
for (const item of items) {
  const where = `dod-register item ${item.id} (${item.title})`;
  if (!['guard', 'lane', 'human'].includes(item.enforcedBy)) {
    fail(`${where}: enforcedBy is "${item.enforcedBy}" — it must be exactly one of guard | lane | human. There is no fourth value and no blank; an item that cannot name its enforcer does not go on the page.`);
    continue;
  }
  if (typeof item.check !== 'string' || item.check.trim() === '') {
    fail(`${where}: no \`check\`. A DoD item with no named enforcer is the shape that rotted the 4-page version.`);
    continue;
  }
  if (item.humanHalf !== undefined && !humanRows.includes(item.humanHalf)) {
    fail(`${where}: \`humanHalf\` names "${item.humanHalf}", which is not one of the register's humanReviewRows [${humanRows.join(', ')}]. A human half pointing at nothing is worse than an admitted gap.`);
  }

  if (item.enforcedBy === 'human') {
    humanItems++;
    if (!humanRows.includes(item.check)) {
      fail(`${where}: enforced by human, but \`check\` "${item.check}" is not one of the register's humanReviewRows [${humanRows.join(', ')}]. The verdict has to live in a row somebody signs.`);
    }
    continue;
  }

  mechanical++;
  if (item.enforcedBy === 'guard') {
    if (!guardFiles.has(item.check)) {
      fail(`${where}: names guard "${item.check}", which is not a file in tooling/ci/.`);
      continue;
    }
    const needle = `tooling/ci/${item.check}`;
    const hits = [];
    for (const wf of workflows) {
      for (const [job, body] of wf.jobs) {
        if (jobRunText(body).includes(needle)) hits.push({ wf, job });
      }
    }
    if (hits.length === 0) {
      fail(
        `${where}: guard "${item.check}" exists in tooling/ci/ but NO workflow \`run:\` step invokes it. ` +
          'File presence is not enforcement — a guard nothing runs cannot fail a build, and a mention in a ' +
          'comment is not an invocation (comments are stripped before this scan, full-line and trailing).',
      );
      continue;
    }
    const gated = hits.filter((h) => h.wf.events.has('push') && (h.wf.rel !== '.github/workflows/ci.yml' || gateNeeds.has(h.job)));
    if (gated.length === 0) {
      fail(
        `${where}: guard "${item.check}" is invoked (${hits.map((h) => `${h.wf.rel}:${h.job}`).join(', ')}) ` +
          `but by no job that both runs \`on: push\` AND is in ${AGGREGATOR}'s \`needs:\` ` +
          `[${[...gateNeeds].join(', ')}]. A lane outside that list can go red while the merge goes through, ` +
          'so "runs per push" would not mean "can fail the merge".',
      );
    }
  } else {
    // lane
    if (!ci.jobs.has(item.check)) {
      fail(`${where}: names lane "${item.check}", which is not a job in ci.yml. ci.yml declares [${[...ci.jobs.keys()].join(', ')}].`);
      continue;
    }
    if (!ci.events.has('push')) {
      fail(`${where}: lane "${item.check}" lives in a workflow whose \`on:\` does not include push.`);
    } else if (!gateNeeds.has(item.check)) {
      fail(`${where}: lane "${item.check}" is not in ${AGGREGATOR}'s \`needs:\` [${[...gateNeeds].join(', ')}], so it can go red while the merge goes through.`);
    }
  }
}
if (mechanical === 0) {
  coverageLost([
    'not one register item is enforced by a guard or a lane — every row says `human`.',
    'The N-3 resolution above would then range over nothing and report a clean sweep of it. A DoD whose',
    'every item is a judgment is the folklore this stage exists to replace.',
  ]);
}

// ═════ 2 · THE PER-APP RECORD (N-2) ══════════════════════════════════════════
const today = new Date().toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Catalogue rows, for the lifecycle anchor. Absence is not fatal — the file is
 *  reverted at various points of the brick lane — but a MALFORMED one is, because
 *  the anchor would then silently stop anchoring. */
let catalogue = null;
if (has('sites/_shared/_data/apps.json')) {
  try {
    catalogue = JSON.parse(read('sites/_shared/_data/apps.json'));
  } catch (e) {
    coverageLost([`sites/_shared/_data/apps.json could not be parsed (${e.message}) — the lifecycle anchor reads it.`]);
  }
}

const shallow = spawnSync('git', ['-C', ROOT, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' });
const isShallow = shallow.status === 0 && shallow.stdout.trim() === 'true';

/** Last commit touching a path, ISO date only, or null when git knows nothing. */
function lastCommitDay(relPath) {
  const r = spawnSync('git', ['-C', ROOT, 'log', '-1', '--format=%cI', '--', relPath], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const t = r.stdout.trim();
  return t === '' ? null : t.slice(0, 10);
}

/** Every Dart file under the app's own test trees — the files its test lane runs. */
function testFilesOf(appDir) {
  const out = [];
  for (const sub of ['test', 'integration_test']) {
    const dir = join(ROOT, appDir, sub);
    if (!existsSync(dir)) continue;
    const walk = (d, rel) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, `${rel}/${e.name}`);
        else if (e.name.endsWith('.dart')) out.push({ rel: `${rel}/${e.name}`, text: readFileSync(p, 'utf8') });
      }
    };
    walk(dir, `${appDir}/${sub}`);
  }
  return out;
}

/** Brace-matched body of the callback that follows a declaration match. */
function bodyAfter(blanked, from) {
  const open = blanked.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    if (blanked[i] === '{') depth++;
    else if (blanked[i] === '}') {
      depth--;
      if (depth === 0) return blanked.slice(open + 1, i);
    }
  }
  return null;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let recordsChecked = 0;
let featureRows = 0;
let claimingDone = 0;
const staleness = [];
const unverifiable = [];

for (const appDir of domain) {
  const appId = appDir.split('/').pop();
  const recRel = `${appDir}/dod.json`;
  if (!has(recRel)) {
    fail(
      `${appId}: no done-record at ${recRel}. Every non-exempt app carries one — "is this app done?" is ` +
        'answered by a record or it is answered by somebody\'s memory. A freshly stamped app is born with ' +
        `one from the brick (${BRICK_APP}/dod.json); if this is the probe, the brick stopped stamping it.`,
    );
    continue;
  }
  let rec;
  try {
    rec = JSON.parse(read(recRel));
  } catch (e) {
    fail(`${appId}: ${recRel} is not valid JSON (${e.message}).`);
    continue;
  }
  recordsChecked++;

  if (rec.app !== appId) {
    fail(`${appId}: ${recRel} says \`app: "${rec.app}"\`. A record naming a different app travelled here by copy-paste, which is how a done claim ends up describing something else.`);
  }
  const status = rec.status;
  if (status !== 'stamped' && status !== 'claiming-done') {
    fail(`${appId}: \`status\` is ${JSON.stringify(status)} — it must be "stamped" or "claiming-done". There is no third state and no blank.`);
    continue;
  }
  const done = status === 'claiming-done';
  if (done) claimingDone++;

  // 🔴 THE FALSIFIABLE ANCHOR. An app the public catalogue calls `live` while its
  // own record still says `stamped` is a real, producible red — and it is the only
  // thing stopping `stamped` from being a permanent excuse.
  if (catalogue) {
    const row = catalogue.find((r) => r && r.slug === appId);
    if (row && row.status === 'live' && !done) {
      fail(
        `${appId}: sites/_shared/_data/apps.json advertises it as "live" to the public while its ` +
          'done-record still says `status: "stamped"`. `stamped` means nobody has claimed the app is ' +
          'finished; `live` is a promise to a stranger that it is. One of the two is wrong, and the ' +
          'catalogue is the one users can see.',
      );
    }
  }

  // ── items: SET-EQUAL to the register ──────────────────────────────────────
  const recItems = rec.items && typeof rec.items === 'object' && !Array.isArray(rec.items) ? rec.items : null;
  if (recItems === null) {
    fail(`${appId}: \`items\` must be an object of "<register id>": { claim, note }.`);
  } else {
    for (const item of items) {
      const row = recItems[item.id];
      if (row === undefined) {
        fail(`${appId}: done-record has no row for DoD item ${item.id} (${item.title}). A record that can drop an item silently answers "is it done?" over a smaller question than the one asked.`);
        continue;
      }
      if (!row || (row.claim !== 'held' && row.claim !== 'pending')) {
        fail(`${appId}: item ${item.id} has claim ${JSON.stringify(row && row.claim)} — it must be "held" or "pending".`);
        continue;
      }
      if (item.enforcedBy !== 'human') {
        if (row.claim !== 'held') {
          fail(
            `${appId}: item ${item.id} (${item.title}) is marked "pending", but it is enforced by ` +
              `${item.enforcedBy} "${item.check}", which runs on this app on every push. A mechanical item ` +
              'is not something an app opts out of — if the enforcement really does not cover this app, the ' +
              'register row is wrong, not the record.',
          );
        }
      } else if (row.claim === 'held' && !done) {
        fail(
          `${appId}: item ${item.id} (${item.title}) is claimed "held", but it is a HUMAN judgment and the ` +
            'app\'s status is "stamped". A verdict nobody recorded is the folklore N-8 exists to end; flip ' +
            'the app to "claiming-done" with a signed humanReview row, or leave the item pending.',
        );
      }
    }
    for (const id of Object.keys(recItems)) {
      if (!items.some((i) => i.id === id)) {
        fail(`${appId}: done-record claims DoD item "${id}", which has no row in ${REGISTER_REL}. An app cannot invent its own DoD items.`);
      }
    }
  }

  // ── features (N-5): resolve, do not match ─────────────────────────────────
  const features = Array.isArray(rec.features) ? rec.features : null;
  if (features === null) {
    fail(`${appId}: \`features\` must be an array. N-5 is the stage's highest-leverage requirement and this is where it lives.`);
  } else if (features.length === 0) {
    fail(
      `${appId}: \`features: []\`. "Every primary feature action provably does its real work" over zero ` +
        'features is the vacuous check this requirement exists to replace — a dead purchase button is zero ' +
        'revenue with green CI, and the one live app has shipped that class three times. A stamped app is ' +
        'born with the template\'s own five real feature rows; an empty list means somebody removed them.',
    );
  } else {
    const testFiles = testFilesOf(appDir);
    if (testFiles.length === 0) {
      fail(`${appId}: no Dart files under ${appDir}/test or ${appDir}/integration_test, so no feature row could resolve to a test the app's lane runs.`);
    }
    const stripped = testFiles.map((f) => ({ rel: f.rel, code: stripDartComments(f.text) }));
    const blanked = stripped.map((f) => blankDartStrings(f.code));

    features.forEach((f, idx) => {
      const at = `${appId}: feature[${idx}]${f && f.name ? ` "${f.name}"` : ''}`;
      for (const k of ['name', 'primaryAction', 'test', 'effect']) {
        if (typeof f?.[k] !== 'string' || f[k].trim() === '') {
          fail(`${at}: \`${k}\` is missing or blank.`);
          return;
        }
      }
      featureRows++;

      // 1 · the test must be a DECLARATION with a NON-EMPTY BODY
      const decl = new RegExp(`\\b(?:test|testWidgets)\\(\\s*'${escape(f.test)}'`);
      let found = false;
      let hollow = false;
      for (let i = 0; i < stripped.length; i++) {
        const m = decl.exec(stripped[i].code);
        if (!m) continue;
        found = true;
        const body = bodyAfter(blanked[i], m.index + m[0].length);
        if (body === null || body.trim() === '') { hollow = true; continue; }
        hollow = false;
        break;
      }
      if (!found) {
        fail(
          `${at}: no \`test('${f.test}'\` / \`testWidgets('${f.test}'\` DECLARATION in ${appDir}/test. ` +
            'A name-existence check is satisfied by the string sitting in a comment or a TODO — this repo ' +
            'has already shipped a scanner that counted exactly that — so the declaration must be there, ' +
            'in a file the app\'s own test lane runs.',
        );
        return;
      }
      if (hollow) {
        fail(`${at}: \`${f.test}\` is declared with an EMPTY BODY. A test that asserts nothing passes forever and discriminates nothing.`);
        return;
      }

      // 2 · the implementation anchor
      const [effFile, effSymbol] = (() => {
        const i = f.effect.lastIndexOf(':');
        return i === -1 ? [f.effect, ''] : [f.effect.slice(0, i), f.effect.slice(i + 1)];
      })();
      if (effSymbol.trim() === '') {
        fail(`${at}: \`effect\` must be "<file>:<symbol>" — "${f.effect}" names no symbol, so a deleted implementation could not be noticed.`);
        return;
      }
      const effRel = `${appDir}/${effFile}`;
      if (!has(effRel)) {
        fail(`${at}: the effect file ${effRel} does not exist, so the test is anchored to nothing and would survive its own feature's deletion.`);
        return;
      }
      const effCode = stripDartComments(read(effRel));
      if (!effCode.includes(effSymbol)) {
        fail(
          `${at}: \`${effSymbol}\` no longer appears in ${effRel} (outside comments). The test may well still ` +
            'pass — a hollow test left behind after the implementation is deleted is precisely the shape ' +
            'this anchor exists to catch.',
        );
        return;
      }

      // 3 · the mutation record expires against its own implementation
      const mut = f.mutation;
      if (!mut || typeof mut !== 'object') {
        fail(`${at}: no \`mutation\` record. "Proven once at authoring" with nothing written down is a claim about a past act that can never re-fail.`);
        return;
      }
      for (const k of ['symbol', 'observedRed', 'date']) {
        if (typeof mut[k] !== 'string' || mut[k].trim() === '') {
          fail(`${at}: \`mutation.${k}\` is missing or blank.`);
          return;
        }
      }
      if (!DATE_RE.test(mut.date)) {
        fail(`${at}: \`mutation.date\` is "${mut.date}" — it must be YYYY-MM-DD.`);
        return;
      }
      if (mut.date > today) {
        fail(`${at}: \`mutation.date\` is ${mut.date}, which is in the future. A proof cannot predate itself.`);
        return;
      }
      // A freshly stamped app is UNTRACKED, so git knows nothing about its files.
      // Its implementation IS the brick source it was rendered from, which is
      // tracked — so the clause runs against the probe instead of going quiet.
      let subject = effRel;
      let day = lastCommitDay(effRel);
      if (day === null) {
        subject = `${BRICK_APP}/${effFile}`;
        day = lastCommitDay(subject);
      }
      if (day === null) {
        unverifiable.push(`${at}: neither ${effRel} nor its brick source has any commit history, so the mutation record's freshness could not be established.`);
      } else if (mut.date < day) {
        fail(
          `${at}: the mutation was recorded ${mut.date} and ${subject} was last changed ${day}. ` +
            'The record now describes code that is no longer there — re-run the mutation against what is ' +
            'in the tree today and re-date the row. This is what turns "proven once in a terminal" into a ' +
            'state rather than an event.',
        );
      }
    });
  }

  // ── humanReview (N-8) ─────────────────────────────────────────────────────
  const hr = Array.isArray(rec.humanReview) ? rec.humanReview : null;
  if (hr === null) {
    fail(`${appId}: \`humanReview\` must be an array of the ${humanRows.length} required rows.`);
  } else if (hr.length === 0) {
    fail(
      `${appId}: COVERAGE LOST — \`humanReview: []\`. An empty section has no malformed rows, so every row ` +
        'is well-formed and the section reads complete. The required rows are the contract: ' +
        `${humanRows.join(' · ')}.`,
    );
  } else {
    const byId = new Map(hr.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
    for (const id of humanRows) {
      const row = byId.get(id);
      if (!row) {
        fail(`${appId}: humanReview is MISSING the required row "${id}". A missing row fails, not merely a malformed one — the four judgments are one sign-off, not four optional ones.`);
        continue;
      }
      for (const k of ['verdict', 'reviewer', 'date', 'artifact']) {
        if (!(k in row)) {
          fail(`${appId}: humanReview row "${id}" has no \`${k}\` field. A verdict with no artifact reviewed is a memory.`);
        }
      }
      if (typeof row.date === 'string' && row.date !== '') {
        if (!DATE_RE.test(row.date)) fail(`${appId}: humanReview row "${id}" has date "${row.date}" — it must be YYYY-MM-DD.`);
        else if (row.date > today) fail(`${appId}: humanReview row "${id}" is dated ${row.date}, in the future.`);
      }
      if (done) {
        for (const k of ['verdict', 'reviewer', 'date', 'artifact']) {
          if (typeof row[k] !== 'string' || row[k].trim() === '') {
            fail(`${appId}: claims done, and humanReview row "${id}" has a blank \`${k}\`. The judgment stays human; the RECORDING of it is mechanical, and this is the recording.`);
          }
        }
      }
      // ⚠️ STALENESS PRINTS, IT DOES NOT FAIL. [pipeline C-6]'s rule: a guard on
      // work only the owner can do must not halt all of CI — a build somebody has
      // to switch off to ship is a build somebody switches off.
      if (typeof row.date === 'string' && DATE_RE.test(row.date)) {
        const libDay = lastCommitDay(`${appDir}/lib`);
        if (libDay && row.date < libDay) {
          staleness.push(`${appId}: humanReview "${id}" was signed ${row.date}; ${appDir}/lib last changed ${libDay}.`);
        }
      }
    }
    for (const row of hr) {
      if (row && typeof row.id === 'string' && !humanRows.includes(row.id)) {
        fail(`${appId}: humanReview declares row "${row.id}", which is not one of the register's humanReviewRows. Adding a fifth judgment means adding it to the register, where every app inherits it.`);
      }
    }
  }

  // ── selection (N-9): only what CI can see, and it says which half ─────────
  const sel = rec.selection;
  if (!sel || typeof sel !== 'object' || Array.isArray(sel)) {
    fail(`${appId}: \`selection\` must be an object. §2.1's three gates are "fail any = drop", and a factory that stamps an unselected app has automated a mistake.`);
  } else {
    for (const k of ['record', 'sha256', 'decided', 'decidedBy']) {
      if (!(k in sel)) fail(`${appId}: \`selection.${k}\` is absent.`);
    }
    const gates = sel.gates;
    if (!gates || typeof gates !== 'object' || Array.isArray(gates)) {
      fail(`${appId}: \`selection.gates\` must be an object carrying g1a, g1b, g1c, g2, g3.`);
    } else {
      for (const g of ['g1a', 'g1b', 'g1c', 'g2', 'g3']) {
        if (!(g in gates)) {
          fail(
            `${appId}: \`selection.gates.${g}\` is absent. G1 is split three ways on purpose: g1a is Apple ` +
              '4.3(a) (multiple Bundle IDs), which is a PORTFOLIO property — its failure mode is not one ' +
              'rejected app but the developer account every app ships through. ⚠️ UNVERIFIED: that clause ' +
              'number is carried from 00-STAGE-3-14-RESEARCH.md, not read from developer.apple.com.',
          );
        }
      }
    }
    if (typeof sel.decided === 'string' && sel.decided !== '') {
      if (!DATE_RE.test(sel.decided)) fail(`${appId}: \`selection.decided\` is "${sel.decided}" — it must be YYYY-MM-DD.`);
      else if (sel.decided > today) fail(`${appId}: \`selection.decided\` is ${sel.decided}, in the future. A decision cannot have been taken tomorrow.`);
    }
    if (done) {
      for (const k of ['record', 'sha256', 'decided', 'decidedBy']) {
        if (typeof sel[k] !== 'string' || sel[k].trim() === '') {
          fail(`${appId}: claims done and \`selection.${k}\` is blank. The gate decisions are the owner's; recording them is not optional.`);
        }
      }
      if (gates && typeof gates === 'object') {
        for (const g of ['g1a', 'g1b', 'g1c', 'g2', 'g3']) {
          if (typeof gates[g] !== 'string' || gates[g].trim() === '') {
            fail(`${appId}: claims done and \`selection.gates.${g}\` is blank.`);
          }
        }
      }
    }
    if (typeof sel.record === 'string' && sel.record.trim() !== '') {
      unverifiable.push(
        `${appId}: selection record "${sel.record}" sha256 "${sel.sha256 ?? ''}" is NOT verifiable from the ` +
          'public repo — company/ is gitignored. Run `node tooling/scripts/check-selection-record.mjs` locally.',
      );
    }
  }
}

if (isShallow) {
  coverageLost([
    'this is a SHALLOW clone (`git rev-parse --is-shallow-repository` = true).',
    'At fetch-depth 1 there is exactly one commit, dated at checkout time, so `git log -1 -- <file>` returns',
    'that date for every file — every mutation record would read as stale and every human-review row as',
    'freshly signed. The lane must check out with `fetch-depth: 0`. This is COVERAGE LOST rather than a',
    'printed note on purpose: "I could not check" must never look like "ok".',
  ]);
}

if (unverifiable.length) {
  console.log(`⬜ ${unverifiable.length} thing(s) this guard could NOT verify from the public repo, printed rather than implied:`);
  for (const u of unverifiable) console.log(`   · ${u}`);
}
if (staleness.length) {
  console.log(`⬜ ${staleness.length} human-review row(s) older than the code they judged (PRINTED, not failed — owner-gated work must not halt CI):`);
  for (const s of staleness) console.log(`   · ${s}`);
}

if (problems.length) {
  console.error(`FAIL app DoD — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-2] The done-record is what makes "is app X done?" a query instead of a memory,');
  console.error('  and every other requirement in stage 6 expresses its acceptance through it.');
  console.error('\nassert-app-dod: FAILED');
  process.exit(1);
}

console.log(
  `ok  app DoD — ${recordsChecked} done-record(s): the brick template plus ${stampedApps.length} stamped ` +
    `app(s) of the workspace's ${appMembers.length} app member(s) ` +
    `(${appMembers.length - stampedApps.length} exempt by name); ${items.length} register item(s), ${mechanical} ` +
    `mechanical and each resolved to a run: step in a push-triggered job inside ${AGGREGATOR}'s needs, ` +
    `${humanItems} human; ${featureRows} feature row(s) resolved to a declared, non-empty test plus an ` +
    `implementation anchor and a mutation record no older than the code it probed; ${claimingDone} app(s) ` +
    'claiming done (the human-verdict and selection clauses have no real instance until one does)',
);
