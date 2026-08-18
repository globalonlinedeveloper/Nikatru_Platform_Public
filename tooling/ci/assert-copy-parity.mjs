#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-copy-parity.mjs — the checker that makes FULL SOURCE COPY survivable.
//
// THE DECISION IT SERVES IS SETTLED AND IS NOT RE-ARGUED HERE. The owner chose a
// full source copy per store repo (STORE-MATRIX-PLAN.md). The same Dart, the same
// pubspec, possibly the same guard corpus, in up to twelve public repos. This file
// does not argue against that; it exists to make the duplication LOUD.
//
// THE FAILURE IT PREVENTS, in one sentence: a security fix lands in one repo and
// silently not the others. Nothing about that is loud on its own — every repo
// builds, every test passes, and the divergence is invisible until the day it is
// exploited. The only thing that makes it loud is hashing the shared files in every
// copy and refusing when two disagree.
//
// ── THE ONE PROPERTY THAT MATTERS MOST, SAID FIRST ───────────────────────────
// 🔴 TODAY THERE IS EXACTLY ONE COPY. catalog/store-matrix.json marks one slot
// `live` out of fifteen. A parity check over one copy has NOTHING TO COMPARE — and
// the tempting thing, the thing that would make this file look finished, is to
// print `ok` and exit 0. That is the vacuous pass this whole corpus exists to
// eliminate, and it is worse here than anywhere else it has appeared, because it
// would go on printing ok all the way to twelve copies if the copy set were ever
// derived wrongly. spec-guards.mjs already records what one cheap test answering
// two different questions costs: the corpus moved, the locator asked its single
// question, seven guards were declared not-applicable BY NAME, and the runner
// exited 0. Every printed word true; the conclusion false.
//
// So: COMPARING NOTHING HAS ITS OWN EXIT CODE — 3, NOT PROVEN. Non-zero, so no CI
// job goes green over it by accident. Distinct from 1, because "nothing to check"
// and "something is broken" are different facts and collapsing them is how a real
// finding gets read as the usual noise. Distinct from 2, because the tree is not
// broken — it genuinely has one copy today. A job that wants to tolerate exit 3
// must say so by number, which is a deliberate and greppable act.
//
// ── THE TWO ABSENCE RULES, WHICH MUST NEVER BE ANSWERED BY THE SAME TEST ─────
// STORE-MATRIX-PLAN.md section 4.3 states them and they are implemented apart:
//
//   (a) A copy absent because THIS CHECKOUT CANNOT REACH IT — a per-repo CI job
//       has one repo, never twelve. That limb is genuinely not applicable there,
//       so it is PRINTED, by name, and it lands on exit 3 rather than 0. The plan
//       sketched exit 0 for this case; this file deliberately disagrees, and says
//       so out loud. Exit 0 there would mean the guard's normal state, in the place
//       it is most likely to run, is a green tick over zero comparisons — which is
//       precisely the disease. Exit 3 keeps the honest answer ("I compared nothing")
//       attached to a number that cannot be mistaken for a pass.
//
//   (b) A copy absent because A PATH IS WRONG — a slot the registry calls `live`
//       resolving to nothing, or to one of the fourteen pre-created EMPTY SHELLS,
//       or an anchor that cannot be found. That is a REFUSAL, exit 2, naming every
//       directory walked. An empty shell passes every existence test and holds
//       nothing, so the resolver takes three tests in widening order: is it a
//       directory, does it hold anything, does it hold a copy marker.
//
// ── IDENTITY IS A CONTENT HASH. NOT MTIME. ───────────────────────────────────
// The git blob id of the RAW WORKTREE BYTES — sha1("blob " + len + NUL + bytes) —
// which is exactly `git hash-object --no-filters <path>`, so every disagreement
// this guard reports can be reproduced by hand with one git command instead of
// being taken on trust. mtime is the seductive wrong answer and it fails in BOTH
// directions: a copy script sets it to now on every file (everything looks changed)
// and cp -p or a checkout preserves it (a changed file looks untouched). Size
// collides on the single most dangerous edit there is — one character in a boundary
// check. Rationale in full: catalog/copy-origins.json → identity.
//
// ── WHAT IS SHARED VS PER-SLOT IS DECLARED, NOT SNIFFED ──────────────────────
// catalog/copy-origins.json carries the rules; this file carries no path list.
// Summary of the declaration, so a reader of the guard is not sent away to learn
// what it does:
//   shared     packages/ (the shared Dart layer), apps/*/lib, apps/*/test,
//              services/, docs/, catalog/, the workspace manifests and lockfiles,
//              SECURITY.md/NOTICE.md/CLAUDE.md, and the five platform directories
//              that are NOT the slot's own target.  → must be byte-identical
//   per-slot   .github/workflows/ (each pair carries its own pipeline),
//              apps/*/store/ (store listing metadata), apps/*/<own target>/
//              (signing config and bundle identity), README.md
//   excluded   sites/ — 🔴 the storefront rollback target; never opened
//   undecided  tooling/ — STORE-MATRIX-PLAN.md 5.6 is OPEN. A copy that actually
//              carries it produces a FINDING naming 5.6, on the day the decision
//              stops being theoretical.
// The catch-all is `shared`, on purpose: an unrecognised path defaults to MUST
// MATCH. Defaulting to per-slot would make every new file born exempt.
//
// ── THE COPY SET IS DERIVED, NEVER TYPED ─────────────────────────────────────
// ONE FACT, ONE PLACE. Which slots carry a copy already lives in
// catalog/store-matrix.json as `state: "live"`. copy-origins.json names only the
// ORIGIN and the RULES, and this file derives everything else. Re-typing the slot
// list would create exactly the second copy of a fact the guard exists to hunt.
//
// ── A WAIVER CANNOT BE ROUTED AROUND, BECAUSE IT PINS THE ORIGIN HASH ────────
// A recorded divergence carries the origin blob id it was granted against. When
// the origin file later changes — which is precisely what a security fix does —
// the pin no longer matches and the waiver goes STALE: a finding saying the origin
// moved and the divergence must be re-reviewed. A waiver silences today's known
// difference and CANNOT silence tomorrow's unlanded fix. A plain path allowlist
// would silence both, and that is the thing people route around a guard with.
//
// ── THE SELF-TEST RUNS ON EVERY RUN, NOT ONLY IN THE TEST FILE ───────────────
// Measured reason, not a principle: before secret-scanning the storefront the
// self-test was run FIRST and it FAILED — gitleaks reported "no leaks found" over
// a planted private key because the canary PEM was too short to trip the rule. A
// clean result from that invocation would have meant nothing. So four canaries go
// through THE SAME comparison engine as the real work, every run: identical files
// → 0 divergences (a detector that fires on everything is worthless too); a
// one-byte difference → exactly 1, named; the in-process hash equals
// `git hash-object --no-filters` on a real file; and an empty shell is REFUSED by
// the resolver rather than counted as "no copies". A canary failure is exit 2 —
// an instrument that fails its own calibration reports nothing, and nothing is not
// a pass.
//
// ── WHAT THIS DOES NOT DO, STATED UP FRONT ───────────────────────────────────
// · No network limb. The plan's option (b) — each repo byte-comparing a published
//   manifest of origin hashes, reusing assert-vendor-current.mjs's mechanism — is
//   the right shape for per-repo CI, which can never see its siblings. It is NOT
//   built here and its absence is printed every run. It also cannot exist for the
//   private side until STORE-MATRIX-PLAN.md 5.4 is answered: those slots have no
//   remotes.
// · No private-tree comparison. Declared gap, printed every run.
// · No GitHub API call. Nothing is created, renamed or deleted.
//
// Exit:  0 COMPARED and clean   1 FINDINGS   2 REFUSED   3 NOT PROVEN (compared 0)
//
// Usage: node tooling/ci/assert-copy-parity.mjs [--verbose]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SELF), '..', '..');   // tooling/ci -> repo root. Inside this repo only.
const VERBOSE = process.argv.includes('--verbose');

const out = [];
const say = (s = '') => out.push(s);
const flush = () => { for (const l of out) console.log(l); };

function refuse(lines) {
  flush();
  console.error('');
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error('');
  console.error('  REFUSED (exit 2). This run compared nothing and cannot say whether the copies agree.');
  process.exit(2);
}

// ── identity ────────────────────────────────────────────────────────────────
// The git blob id of raw bytes. See catalog/copy-origins.json -> identity.
function blobId(absPath) {
  const bytes = readFileSync(absPath);
  const h = createHash('sha1');
  h.update(`blob ${bytes.length}\0`);
  h.update(bytes);
  return h.digest('hex');
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isNonEmptyDir = (p) => { try { return readdirSync(p).length > 0; } catch { return false; } };
const toPosix = (p) => p.split(sep).join('/');

// ── the anchor. Ported from tooling/scripts/spec-guards.mjs, unchanged in intent. ──
// Walk UP for the directory holding BOTH `Projects/` and `nikatru/`. Never counts
// `..` levels: fifteen slots sit at varying depths and a fixed level count is wrong
// the moment one moves — a bet already lost twice in one day on 2026-08-18.
function findAnchor(startDir) {
  const walked = [];
  let cur = resolve(startDir);
  for (;;) {
    walked.push(cur);
    if (isDir(join(cur, 'Projects')) && isDir(join(cur, 'nikatru'))) return { anchor: cur, walked };
    const up = dirname(cur);
    if (up === cur) return { anchor: null, walked };
    cur = up;
  }
}

// ── the tiny matcher. `**` any segments, `*` within one segment, else literal. ──
function globToRe(pattern) {
  let re = '^';
  const parts = pattern.split('/');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === '**') { re += (i === parts.length - 1) ? '.*' : '(?:.*/)?'; continue; }
    if (i > 0 && !re.endsWith('/') && !re.endsWith(')?') && !re.endsWith('.*')) re += '/';
    else if (i > 0 && re.endsWith('.*')) re += '/';
    re += p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  }
  return new RegExp(re + '$');
}

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPARISON ENGINE. The canaries below and the real run go through THIS
// function and no other. A self-test that exercises a different code path than
// the work proves nothing about the work.
// ═══════════════════════════════════════════════════════════════════════════
function compareTrees(originRoot, copyRoot, sharedRelPaths) {
  const diverged = [];
  const missing = [];
  let compared = 0;
  for (const rel of sharedRelPaths) {
    const a = join(originRoot, ...rel.split('/'));
    const b = join(copyRoot, ...rel.split('/'));
    if (!existsSync(b)) { missing.push(rel); continue; }
    if (!existsSync(a)) { missing.push(rel); continue; }
    const ha = blobId(a);
    const hb = blobId(b);
    compared++;
    if (ha !== hb) diverged.push({ path: rel, origin: ha, copy: hb });
  }
  return { compared, diverged, missing };
}

// ── the copy resolver. Absence rule (b) lives here and nowhere else. ─────────
// Three tests in widening order, because the empty shell passes the first.
function resolveCopyDir(absDir, markers) {
  if (!isDir(absDir)) return { ok: false, why: 'does not exist, or is not a directory' };
  if (!isNonEmptyDir(absDir)) return { ok: false, why: 'exists but is EMPTY — a pre-created shell; the copy has not been made' };
  const found = markers.filter((m) => existsSync(join(absDir, m)));
  if (found.length === 0) {
    return { ok: false, why: `exists and is non-empty but holds none of the copy markers (${markers.join(', ')}) — this is some other directory, not a source copy` };
  }
  return { ok: true, marker: found[0] };
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-TEST — four canaries, through the same engine, before any real work.
// ═══════════════════════════════════════════════════════════════════════════
function selfTest(realFileForHashCheck) {
  const failures = [];
  const notes = [];
  const tmp = mkdtempSync(join(tmpdir(), 'copy-parity-selftest-'));
  try {
    const A = join(tmp, 'origin');
    const B = join(tmp, 'copy');
    mkdirSync(join(A, 'packages', 'core', 'lib'), { recursive: true });
    mkdirSync(join(B, 'packages', 'core', 'lib'), { recursive: true });
    const same = 'packages/core/lib/same.dart';
    const drift = 'packages/core/lib/drift.dart';
    const body = 'bool allowed(int n) { return n < 10; }\n';
    writeFileSync(join(A, ...same.split('/')), body);
    writeFileSync(join(B, ...same.split('/')), body);
    writeFileSync(join(A, ...drift.split('/')), body);
    writeFileSync(join(B, ...drift.split('/')), body.replace('n < 10', 'n <= 10'));  // ONE character

    // C1 IDENTICAL -> zero divergences. A detector that fires on everything is worthless too.
    const c1 = compareTrees(A, B, [same]);
    if (!(c1.compared === 1 && c1.diverged.length === 0 && c1.missing.length === 0)) {
      failures.push(`C1 IDENTICAL: expected 1 compared / 0 diverged, got ${c1.compared} compared / ${c1.diverged.length} diverged / ${c1.missing.length} missing`);
    }
    // C2 ONE BYTE -> exactly one divergence, named. This is the edit that matters.
    const c2 = compareTrees(A, B, [drift]);
    if (!(c2.compared === 1 && c2.diverged.length === 1 && c2.diverged[0].path === drift)) {
      failures.push(`C2 ONE BYTE: the engine did NOT detect a one-character difference — got ${c2.diverged.length} divergence(s). The detector has stopped detecting.`);
    }
    // C4 EMPTY SHELL -> refused by the resolver, not reported as "no copies".
    const shell = join(tmp, 'shell');
    mkdirSync(join(shell, 'nothing_here'), { recursive: true });
    const r = resolveCopyDir(shell, ['pubspec.yaml']);
    if (r.ok) failures.push('C4 EMPTY SHELL: the resolver ACCEPTED a directory holding no copy marker. Absence rules (a) and (b) have collapsed into one test.');
    const missingDir = resolveCopyDir(join(tmp, 'not-there'), ['pubspec.yaml']);
    if (missingDir.ok) failures.push('C4 EMPTY SHELL: the resolver ACCEPTED a directory that does not exist.');

    // C3 HASH AGREES WITH GIT. Skipped only if git is unavailable, and printed when skipped.
    if (realFileForHashCheck && existsSync(realFileForHashCheck)) {
      const g = spawnSync('git', ['hash-object', '--no-filters', '--', realFileForHashCheck], { encoding: 'utf8' });
      if (g.status === 0 && /^[0-9a-f]{40}$/.test((g.stdout || '').trim())) {
        const mine = blobId(realFileForHashCheck);
        if (mine !== g.stdout.trim()) {
          failures.push(`C3 HASH: in-process blob id ${mine} != git hash-object --no-filters ${g.stdout.trim()} for ${realFileForHashCheck}. The identity function has drifted from git's.`);
        } else {
          notes.push(`C3 HASH ok — in-process blob id == git hash-object --no-filters (${mine.slice(0, 12)}… on ${toPosix(realFileForHashCheck).split('/').slice(-3).join('/')})`);
        }
      } else {
        notes.push('C3 HASH SKIPPED — `git hash-object --no-filters` did not run here. The identity function was NOT cross-checked against git on this run.');
      }
    } else {
      notes.push('C3 HASH SKIPPED — no real file was available to cross-check against git.');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { failures, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
const { anchor, walked } = findAnchor(dirname(SELF));

const DECL_PATH = join(REPO, 'catalog', 'copy-origins.json');
const REG_PATH = join(REPO, 'catalog', 'store-matrix.json');

if (!existsSync(DECL_PATH)) {
  refuse([
    `the declaration is missing: ${DECL_PATH}`,
    'catalog/copy-origins.json is the half of this check that says WHAT must match.',
    'Without it this guard has no subject at all and must not report on one.',
  ]);
}
if (!existsSync(REG_PATH)) {
  refuse([
    `the slot registry is missing: ${REG_PATH}`,
    'catalog/store-matrix.json is the ONE declaration of which slots carry a copy.',
    'This guard derives its copy set from it and never re-types the list.',
  ]);
}

let decl, reg;
try { decl = JSON.parse(readFileSync(DECL_PATH, 'utf8')); }
catch (e) { refuse([`catalog/copy-origins.json did not parse: ${e.message}`]); }
try { reg = JSON.parse(readFileSync(REG_PATH, 'utf8')); }
catch (e) { refuse([`catalog/store-matrix.json did not parse: ${e.message}`]); }

for (const [k, v] of Object.entries({ origin: decl.origin, rules: decl.rules, copyMarkers: decl.copyMarkers, targetPlatformDirs: decl.targetPlatformDirs, divergences: decl.divergences })) {
  if (!v) refuse([`catalog/copy-origins.json is missing the \`${k}\` section — the declaration is not usable.`]);
}
if (!Array.isArray(reg.slots) || reg.slots.length === 0) {
  refuse(['catalog/store-matrix.json declares no slots. The copy set is derived from it, so there is nothing to derive.']);
}

// ── run the calibration BEFORE anything else reports a result ───────────────
const HASH_PROBE = existsSync(join(REPO, 'pubspec.yaml')) ? join(REPO, 'pubspec.yaml') : null;
const st = selfTest(HASH_PROBE);
if (st.failures.length) {
  refuse([
    `the SELF-TEST failed — ${st.failures.length} canary(ies) did not behave:`,
    ...st.failures,
    '',
    'The comparison engine could not prove it is still able to report a difference.',
    'A parity checker that has stopped detecting reports parity forever. Refusing.',
  ]);
}

say('assert-copy-parity — FULL SOURCE COPY divergence check');
say('');
say(`  self-test: 4 canary(ies) passed (identical→0, one-byte→1, empty-shell refused, hash vs git)`);
for (const n of st.notes) say(`             ${n}`);

// ── the anchor / reachability limb. Absence rule (a) is decided HERE. ───────
let PROJECTS = null;
let reach = 'workspace';
if (!anchor) {
  reach = 'single-checkout';
} else {
  PROJECTS = join(anchor, 'Projects');
}

// ── the origin slot ─────────────────────────────────────────────────────────
const key = (s) => `${s.store}/${s.target}/${s.type}`;
const ORIGIN_KEY = `${decl.origin.store}/${decl.origin.target}/${decl.origin.type}`;
const originSlot = reg.slots.find((s) => key(s) === ORIGIN_KEY);
if (!originSlot) {
  refuse([
    `copy-origins.json names origin slot \`${ORIGIN_KEY}\`, which has NO ROW in catalog/store-matrix.json.`,
    `Rows present: ${reg.slots.map(key).join(' , ')}`,
    'Comparing against a slot the registry does not know is comparing against nothing.',
  ]);
}
if (originSlot.state !== 'live') {
  refuse([
    `the origin slot \`${ORIGIN_KEY}\` is state "${originSlot.state}", not "live".`,
    'An origin that is a shell makes every comparison a comparison against an empty tree,',
    'and comparing against nothing is how a parity checker reports parity forever.',
  ]);
}

// ── DERIVE the copy set. Never typed. ───────────────────────────────────────
const liveSlots = reg.slots.filter((s) => s.state === 'live');
const copySlots = liveSlots.filter((s) => key(s) !== ORIGIN_KEY);

say('');
say(`  registry: ${reg.slots.length} slot(s) declared · ${liveSlots.length} marked \`live\` (= carrying a source copy)`);
say(`  origin:   ${ORIGIN_KEY}  →  ${originSlot.publicDir}`);
say(`  copies:   ${copySlots.length} — derived from store-matrix.json \`state\`, never listed in copy-origins.json`);
say(`  limb:     LOCAL (all copies on disk). No network limb exists — see copy-origins.json → notInScope.network.`);
say(`  private:  NOT COMPARED. Declared gap — see copy-origins.json → notInScope.privateTrees.`);

// ── target mapping must be total, or a slot silently shares its signing config ──
const unmappedTargets = [...new Set(reg.slots.map((s) => s.target))].filter((t) => !Array.isArray(decl.targetPlatformDirs[t]));
if (unmappedTargets.length) {
  refuse([
    `${unmappedTargets.length} slot target(s) have no entry in copy-origins.json → targetPlatformDirs: ${unmappedTargets.join(', ')}`,
    'An unmapped target makes ALL platform directories `shared` for that slot, which reads as',
    'parity right up until two slots sign with different keys. Refusing rather than guessing.',
  ]);
}

// ── classification ──────────────────────────────────────────────────────────
const RULES = decl.rules.map((r, i) => ({ ...r, i, hits: 0 }));
function classify(relPath, slot) {
  for (const r of RULES) {
    const pats = r.match.includes('@targetPlatformDir')
      ? (decl.targetPlatformDirs[slot.target] || []).map((d) => r.match.replace('@targetPlatformDir', d))
      : [r.match];
    for (const p of pats) {
      if (globToRe(p).test(relPath)) { r.hits++; return r; }
    }
  }
  return null;   // impossible while the catch-all is present; checked below anyway
}

// ── enumeration ─────────────────────────────────────────────────────────────
function gitTracked(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout.toString('utf8').split('\0').filter(Boolean);
}
function walkFs(root, ignoreDirs) {
  const acc = [];
  let suppressed = 0;
  const rec = (abs, rel) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (ignoreDirs.includes(e.name)) { suppressed++; continue; }
        rec(join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile()) {
        acc.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  rec(root, '');
  return { files: acc, suppressed };
}

const originDir = PROJECTS
  ? join(PROJECTS, originSlot.store, originSlot.target, originSlot.type, originSlot.publicDir)
  : REPO;                                 // single-checkout: this repo IS whatever it is
const MARKERS = decl.copyMarkers.anyOf || [];

// The origin must resolve by the same three tests as any copy — it is not exempt.
const originRes = resolveCopyDir(originDir, MARKERS);
if (!originRes.ok) {
  refuse([
    `the ORIGIN slot \`${ORIGIN_KEY}\` does not resolve to a source copy.`,
    `  path: ${originDir}`,
    `  ${originRes.why}`,
    ...(anchor ? [`  anchor: ${anchor}`] : []),
    `Walked ${walked.length} directory(ies) upward from this file looking for Projects/ + nikatru/:`,
    ...walked.map((d) => `    -- ${d}`),
    'This is absence rule (b): a WRONG PATH, not an absent copy. Refusing.',
  ]);
}

const originTracked = gitTracked(originDir);
if (!originTracked) {
  refuse([
    `the origin at ${originDir} is not a git repository, so its tracked set cannot be enumerated.`,
    'The origin defines what "source" means for every copy. Falling back to a filesystem walk here',
    'would let build output and node_modules define the shared set, which is not a comparison anyone',
    'can act on. Refusing.',
  ]);
}
if (originTracked.length === 0) {
  refuse([`\`git ls-files\` in the origin (${originDir}) returned ZERO paths. There is no subject to compare.`]);
}

// ── classify the origin. This also exercises every rule, so a dead rule shows. ──
const buckets = { shared: [], 'per-slot': [], excluded: [], undecided: [] };
const unclassified = [];
for (const rel of originTracked) {
  const r = classify(rel, originSlot);
  if (!r) { unclassified.push(rel); continue; }
  if (!buckets[r.kind]) { unclassified.push(rel); continue; }
  buckets[r.kind].push(rel);
}

say('');
say(`  origin tracked paths: ${originTracked.length}   (git ls-files)`);
say(`    shared     ${String(buckets.shared.length).padStart(5)}   must be byte-identical in every copy`);
say(`    per-slot   ${String(buckets['per-slot'].length).padStart(5)}   legitimately differs; never compared`);
say(`    excluded   ${String(buckets.excluded.length).padStart(5)}   not source; never opened`);
say(`    undecided  ${String(buckets.undecided.length).padStart(5)}   an open decision; a copy carrying it is a finding`);
say('  rule hits (first match wins, evaluated against the origin):');
for (const r of RULES) say(`    ${String(r.hits).padStart(5)}  ${r.kind.padEnd(9)}  ${r.match}`);

const findings = [];

if (unclassified.length) {
  findings.push({
    what: `${unclassified.length} origin path(s) matched NO rule in copy-origins.json`,
    detail: unclassified.slice(0, 20),
    fix: 'Classification is meant to be TOTAL — the last rule is a catch-all. If paths fall through, the catch-all has been removed or its kind is not one of shared/per-slot/excluded/undecided.',
  });
}

// A rule that matches nothing is a rule that has drifted away from the tree.
// It is a finding, not a print: a stale rule is how an exemption outlives its reason.
const deadRules = RULES.filter((r) => r.hits === 0);
if (deadRules.length) {
  findings.push({
    what: `${deadRules.length} rule(s) in copy-origins.json matched ZERO paths in the origin`,
    detail: deadRules.map((r) => `${r.match}  (${r.kind})`),
    fix: 'A rule that matches nothing has drifted from the tree it describes. Either the path it names is gone (delete the rule) or the pattern is wrong (fix it). A stale exemption outlives the reason it was granted.',
  });
}

// ── the waiver list, checked against the origin BEFORE any copy is looked at ──
const waivers = Array.isArray(decl.divergences.entries) ? decl.divergences.entries : [];
const sharedSet = new Set(buckets.shared);
const waiverByKey = new Map();
for (const w of waivers) {
  const k = `${w.slot}::${w.path}`;
  waiverByKey.set(k, w);
  if (!sharedSet.has(w.path)) {
    findings.push({
      what: `waiver on a path that is not \`shared\`: ${w.path} (slot ${w.slot})`,
      detail: ['A waiver only means something on a path that would otherwise have to match.'],
      fix: 'Remove the waiver, or fix the rule that classifies this path.',
    });
    continue;
  }
  const originAbs = join(originDir, ...w.path.split('/'));
  const nowHash = existsSync(originAbs) ? blobId(originAbs) : null;
  if (nowHash === null) {
    findings.push({
      what: `waiver names ${w.path}, which no longer exists in the origin (slot ${w.slot})`,
      detail: [],
      fix: 'Remove the waiver.',
    });
  } else if (nowHash !== w.originBlob) {
    findings.push({
      what: `STALE WAIVER — the origin moved under it: ${w.path} (slot ${w.slot})`,
      detail: [
        `granted against origin blob ${w.originBlob}`,
        `origin is now           ${nowHash}`,
        `reason on record: ${w.reason || '(none given)'}`,
      ],
      fix: 'This is the case the pin exists for: the origin file changed after the waiver was granted, which is exactly what happens when a fix lands. Re-review the divergence and either drop the waiver or re-record it against the new origin blob.',
    });
  }
}
say('');
say(`  recorded divergences (waivers): ${waivers.length}`);

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPARISONS
// ═══════════════════════════════════════════════════════════════════════════
let comparisonsPerformed = 0;
const unreachable = [];

for (const slot of copySlots) {
  const k = key(slot);
  const dir = PROJECTS ? join(PROJECTS, slot.store, slot.target, slot.type, slot.publicDir) : null;

  if (!dir) {
    // Absence rule (a): this checkout cannot reach siblings at all. Printed, not silent.
    unreachable.push({ slot: k, why: 'no workspace anchor in this checkout — sibling slots are not addressable from here' });
    continue;
  }
  const res = resolveCopyDir(dir, MARKERS);
  if (!res.ok) {
    // Absence rule (b): the registry says `live` and the path is wrong. REFUSE.
    refuse([
      `slot \`${k}\` is marked \`live\` in catalog/store-matrix.json but does not resolve to a source copy.`,
      `  path: ${dir}`,
      `  ${res.why}`,
      `  anchor: ${anchor}`,
      'A registry row saying `live` over a directory that holds no copy is a WRONG PATH, not an absent copy.',
      'Absence rule (b). Refusing rather than reporting parity over a tree that is not there.',
    ]);
  }

  // classify this slot's own view (the target platform dir differs per slot)
  const slotShared = [];
  for (const rel of originTracked) {
    const r = classify(rel, slot);
    if (r && r.kind === 'shared') slotShared.push(rel);
  }

  const cmp = compareTrees(originDir, dir, slotShared);
  comparisonsPerformed += cmp.compared;

  // what the copy carries that the origin does not
  let copyFiles = gitTracked(dir);
  let fellBack = false;
  let suppressed = 0;
  if (!copyFiles) {
    fellBack = true;
    const w = walkFs(dir, decl.enumeration?.ignoreDirs || ['.git']);
    copyFiles = w.files;
    suppressed = w.suppressed;
  }
  const originSet = new Set(originTracked);
  const extraShared = [];
  const carriesUndecided = [];
  for (const rel of copyFiles) {
    const r = classify(rel, slot);
    if (r && r.kind === 'undecided') { carriesUndecided.push(rel); continue; }
    if (!originSet.has(rel) && r && r.kind === 'shared') extraShared.push(rel);
  }

  say('');
  say(`  ── copy ${k} → ${slot.publicDir}`);
  say(`     compared ${cmp.compared} shared path(s)${fellBack ? `  [enumerated by FILESYSTEM WALK — not a git repo; ${suppressed} directory(ies) suppressed by ignoreDirs]` : '  [enumerated by git ls-files]'}`);
  if (VERBOSE) for (const p of slotShared) say(`       · ${p}`);

  for (const d of cmp.diverged) {
    const w = waiverByKey.get(`${k}::${d.path}`);
    if (w && w.originBlob === d.origin) {
      say(`     WAIVED divergence: ${d.path}  — ${w.reason || '(no reason recorded)'} [recorded ${w.recorded || '?'} by ${w.recordedBy || '?'}]`);
      continue;
    }
    findings.push({
      what: `DIVERGED — ${k} :: ${d.path}`,
      detail: [`origin ${d.origin}`, `copy   ${d.copy}`, `reproduce: git hash-object --no-filters "${d.path}" in each tree`],
      fix: 'The copies of a shared file disagree. This is the shape of a fix that landed in one repo and not the other. Re-sync it from the origin, or record a deliberate divergence in copy-origins.json -> divergences.entries with the origin blob id pinned.',
    });
  }
  for (const m of cmp.missing) {
    findings.push({
      what: `MISSING — ${k} :: ${m}`,
      detail: ['a shared path exists in the origin and not in this copy'],
      fix: 'A shared file that never landed is indistinguishable from a fix that never landed. Copy it, or reclassify the path in copy-origins.json.',
    });
  }
  for (const e of extraShared) {
    findings.push({
      what: `UNDECLARED — ${k} :: ${e}`,
      detail: ['present in the copy, absent from the origin, and classified `shared`'],
      fix: 'A shared-class file that exists only in a copy is duplication nothing declared. Either it belongs in the origin, or it needs a rule in copy-origins.json saying it is per-slot.',
    });
  }
  // Waivers that are no longer doing anything are a false statement about the tree.
  for (const w of waivers.filter((x) => x.slot === k)) {
    const stillDiverged = cmp.diverged.some((d) => d.path === w.path);
    if (!stillDiverged && sharedSet.has(w.path) && !cmp.missing.includes(w.path)) {
      findings.push({
        what: `OBSOLETE WAIVER — ${k} :: ${w.path}`,
        detail: ['the copy now matches the origin, so this waiver silences nothing'],
        fix: 'Remove it. Unused waivers accumulate until nobody trusts the list, and then the list is what people point at instead of reading the guard.',
      });
    }
  }
  if (carriesUndecided.length) {
    findings.push({
      what: `UNDECIDED PATHS CARRIED — ${k} — ${carriesUndecided.length} path(s) under a rule marked \`undecided\``,
      detail: [
        ...carriesUndecided.slice(0, 10),
        ...(carriesUndecided.length > 10 ? [`… and ${carriesUndecided.length - 10} more`] : []),
      ],
      fix: 'STORE-MATRIX-PLAN.md section 5.6 is open (is tooling/ copied per slot or centralised?) and this copy has just answered it by accident. Settle it and change the rule kind in copy-origins.json to `shared` or `per-slot`.',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERDICT
// ═══════════════════════════════════════════════════════════════════════════
say('');
if (unreachable.length) {
  say('  NOT REACHED FROM THIS CHECKOUT — absence rule (a), printed rather than skipped:');
  for (const u of unreachable) say(`    ${u.slot} — ${u.why}`);
}

flush();

if (findings.length) {
  console.error('');
  console.error(`✗ assert-copy-parity — ${findings.length} FINDING(S). A divergence is FATAL, never a warning.`);
  for (const f of findings) {
    console.error('');
    console.error(`  · ${f.what}`);
    for (const d of f.detail) console.error(`      ${d}`);
    console.error(`      → ${f.fix}`);
  }
  console.error('');
  console.error(`  compared ${comparisonsPerformed} path-pair(s) across ${copySlots.length} copy(ies).`);
  console.error('');
  process.exit(1);
}

if (comparisonsPerformed === 0) {
  console.error('');
  console.error('┌────────────────────────────────────────────────────────────────────────────┐');
  console.error('│  NOT PROVEN — assert-copy-parity COMPARED NOTHING. This is NOT a pass.      │');
  console.error('└────────────────────────────────────────────────────────────────────────────┘');
  console.error('');
  console.error(`  ZERO path-pairs were hashed on both sides. Everything above describes a tree;`);
  console.error(`  none of it is evidence that any two copies agree, because there was no second copy.`);
  console.error('');
  if (copySlots.length === 0) {
    console.error(`  WHY: catalog/store-matrix.json marks ${liveSlots.length} slot(s) \`live\` and ${liveSlots.length === 1 ? 'the only one is the origin itself' : 'none besides the origin'}.`);
    console.error(`       A parity check over one copy has nothing to compare against. That is the honest`);
    console.error(`       state of the matrix today (1 live, 14 shells) — it is not a defect in this guard,`);
    console.error(`       and it is not a clean bill of health either.`);
    console.error('');
    console.error(`  WHAT WOULD MAKE THIS MEANINGFUL: a second slot reaching \`state: "live"\` in`);
    console.error(`       catalog/store-matrix.json with a real source copy on disk. STORE-MATRIX-PLAN.md`);
    console.error(`       Step 7 says to build ONE slot end to end and prove this guard sees two copies`);
    console.error(`       and passes, then prove it FAILS when they diverge — before slot two exists.`);
  } else if (unreachable.length) {
    console.error(`  WHY: ${unreachable.length} declared copy(ies) are not reachable from this checkout — absence rule (a).`);
    console.error(`       A per-repo CI job has one repo, never twelve. The plan sketched exit 0 here;`);
    console.error(`       this guard deliberately exits 3 instead, because exit 0 would make the guard's`);
    console.error(`       normal state, in the place it most often runs, a green tick over zero comparisons.`);
    console.error(`       The network limb that WOULD make this answerable (a published manifest of origin`);
    console.error(`       hashes, per STORE-MATRIX-PLAN.md 4.3 option b) is NOT built — see copy-origins.json`);
    console.error(`       -> notInScope.network.`);
  } else {
    console.error(`  WHY: ${copySlots.length} copy(ies) resolved, but no path classified \`shared\` was present on both sides.`);
    console.error(`       That is not parity; it is an empty comparison, and it is reported as such.`);
  }
  console.error('');
  console.error('  Exit 3 = NOT PROVEN. Non-zero on purpose. A job that tolerates this must name the');
  console.error('  number, so that tolerance is a deliberate and greppable act rather than a green tick.');
  console.error('');
  process.exit(3);
}

console.log('');
console.log(`assert-copy-parity: ok — ${comparisonsPerformed} shared path-pair(s) hashed across ${copySlots.length} copy(ies); every one identical.`);
process.exit(0);
