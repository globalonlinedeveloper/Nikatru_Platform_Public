#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-gate-weakening.mjs — [pipeline N-4] no app opts itself out of the
// factory's enforcement.
//
// THE SEAM, stated so it does not swallow a neighbour: C-12 owns "the rule set
// REACHES every app" (`assert-lint-inheritance.mjs` checks the include is there).
// N-4 owns "no app HOLLOWS IT OUT locally". Both can be true of the tree while one
// app is exempt in practice, and that fail-shape is reported by nothing else:
// every stage-1 and stage-2 guard checks that the checks exist, not that an app
// opted out of them underneath a perfectly correct include.
//
// SIX CLAUSES HERE. The seventh — an app deleting its inherited
// `test/chassis_properties_test.dart`, which drops fourteen property assertions
// with one `rm` and no suppression at all — is enforced by
// `assert-stamp-properties.mjs`, which now reads `apps/*` as well as the brick.
// Shared with N-7 clause 4; built once, not twice, and named here so nobody
// concludes it is unowned.
//
// ── 🔴 THE ALLOWLIST IS `file:rule`, NEVER `file:line:rule`. ─────────────────
//
// The stage doc specifies the exact set of `file:line:rule` triples present when
// the guard lands. That is a stale floor wearing a disguise, and it is not
// speculation — it is measured. Across five days the same single suppression read
// `apps/subly/lib/main.dart:21`, then `:41`, then vanished entirely; the doc's
// own three-entry baseline was already wrong on the day it was written and wrong
// again when this was built. A line-pinned allowlist turns every unrelated
// refactor into a red build on somebody else's branch, and a guard people have to
// edit to ship is a guard people delete.
//
// So the contract is the PAIR — which file, which rule — plus a reason and a
// date. Line numbers go in the failure MESSAGE, where they help, and never in the
// contract, where they rot. And the list is self-checking in both directions: an
// entry whose `file:rule` pair no longer appears anywhere FAILS, because a licence
// nobody is watching is precisely the thing being prevented, and because that
// same check is what proves this scan still reaches the file the baseline lives
// in.
//
// ── WHY EVERY SUPPRESSION, NOT ONLY "ONE NAMING AN INHERITED RULE" ───────────
// The drafted criterion scopes clause 1 to rules in the inherited set. Resolving
// that set means a second scanner reading the shared lint package — a second
// thing that can silently stop matching, in a repo whose recurring failure is
// exactly that. And suppressing a rule that is NOT inherited is still an app
// deciding for itself which analysis applies to it. So: every `// ignore:` and
// every `// ignore_for_file:` in an app-owned Dart tree is allowlisted with a
// reason, or it fails. Strictly stronger, and one scanner instead of two.
//
// ── SCOPE: TRACKED FILES, AND FIVE TREES ─────────────────────────────────────
// `git ls-files`, never a filesystem walk. `apps/subly/.dart_tool/dartpad/
// web_plugin_registrant.dart` carries `ignore_for_file: type=lint` and is
// GENERATED — a walk would fail the build on a file nobody wrote. The trees an
// app owns are `lib/`, `test/`, `integration_test/`, `test_driver/` and
// `live_probe/`; the drafted scope missed the last of those, which is where BOTH
// of the repo's two real suppressions live.
//
// `apps/subly` is IN SCOPE here, and that is deliberate rather than a breach of
// the freeze. 39-CHASSIS §4 cut 1 says Subly is never retrofitted — this guard
// changes nothing about Subly; it records what is already there and refuses
// anything NEW. Excluding it would leave the guard with an empty domain and an
// allowlist mechanism with no entries, which is how a guard ships unable to fail.
//
// Usage:  node tooling/ci/assert-no-gate-weakening.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
/** The Dart trees an app owns. `live_probe/` is on this list because it is where
 *  the entire real baseline lives and the drafted scope did not reach it. */
const OWNED = ['lib', 'test', 'integration_test', 'test_driver', 'live_probe'];
const TEST_TREES = new Set(['test', 'integration_test', 'test_driver']);

/** THE ALLOWLIST — `file:rule`, a reason, and a date. Deleting an entry is the
 *  correct way to close one; widening it is not. Every entry must still be found,
 *  so this list cannot outlive what it excuses. */
const ALLOWLIST = [
  {
    file: 'apps/subly/live_probe/c6_consent_live_probe.dart',
    rule: 'avoid_print',
    date: '2026-08-01',
    reason:
      'the C-6 consent LIVE PROBE is a stdout script run by hand against production, not app code — ' +
      'printing IS its output. apps/subly is the frozen rail-prover (39-CHASSIS §4 cut 1), so this is ' +
      'recorded rather than fixed. If the probe is retired, delete this entry with it.',
  },
];

const problems = [];
const fail = (m) => problems.push(m);

function coverageLost(lines) {
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-no-gate-weakening: FAILED');
  process.exit(1);
}

// ── length-preserving comment/string blanking, for the clauses that must NOT
//    match inside a comment or a string literal. (Clause 1 does the opposite —
//    it is looking FOR comments — so it reads the raw text.)
function blankCommentsAndStrings(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (j) => { if (out[j] !== '\n') out[j] = ' '; };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; out[i] = ' '; out[i + 1] = ' '; i += 2; if (depth === 0) break; continue; }
        blank(i); i++;
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
        if (!isRaw && src[j] === '\\') { blank(j); blank(j + 1); j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') { j++; break; }
        blank(j); j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

// ── THE DETECTORS, hoisted so they can be SELF-TESTED before they are trusted.
//    scan-secrets.mjs does the same thing for the same reason: a detector that
//    quietly stopped matching reports a clean sweep forever.
const SUPPRESSION_RE = /\/\/\s*ignore(_for_file)?:\s*([^\n]+)/g;
const SKIP_RE = /(\bskip:\s*(?:true|'|"))|(@Skip\s*\()|(@TestOn\s*\()/;

const SELF_TEST = [
  { src: '  // ignore: avoid_print\nprint(1);', re: SUPPRESSION_RE, want: true, what: 'a plain // ignore:' },
  { src: '// ignore_for_file: type=lint\n', re: SUPPRESSION_RE, want: true, what: 'a file-level type=lint blanket' },
  { src: 'final x = 1;\n', re: SUPPRESSION_RE, want: false, what: 'ordinary code' },
  { src: "test('x', () {}, skip: true);", re: SKIP_RE, want: true, what: 'skip: true' },
  { src: '@TestOn("vm")\n', re: SKIP_RE, want: true, what: '@TestOn' },
  { src: "test('x', () {});", re: SKIP_RE, want: false, what: 'a plain test' },
];
for (const t of SELF_TEST) {
  t.re.lastIndex = 0;
  const hit = t.re.test(t.src);
  t.re.lastIndex = 0;
  if (hit !== t.want) {
    coverageLost([
      `the detector self-test failed on "${t.what}" (expected ${t.want ? 'a match' : 'no match'}).`,
      'The scan below would then sweep every app and report clean regardless of what is in them.',
      'A detector is only worth what its failing case proves; this one is checked before it is used.',
    ]);
  }
}

// ── the domain: TRACKED files under the brick app + every apps/* tree ────────
const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', 'apps', BRICK_APP], { encoding: 'utf8' });
if (ls.status !== 0) {
  coverageLost([
    '`git ls-files -- apps <brick app>` failed, so the tracked-file domain is unreadable.',
    'A filesystem walk is NOT the fallback: the generated apps/subly/.dart_tool/dartpad/',
    'web_plugin_registrant.dart carries `ignore_for_file: type=lint`, and failing the build on a file',
    'nobody wrote is how a guard gets switched off.',
  ]);
}
const tracked = ls.stdout.split('\n').map((l) => l.trim()).filter(Boolean);

/** Which app root and which owned tree a path belongs to, or null. */
function classify(rel) {
  const roots = [BRICK_APP];
  const m = rel.match(/^(apps\/[^/]+)\//);
  if (m) roots.push(m[1]);
  for (const root of roots) {
    if (!rel.startsWith(`${root}/`)) continue;
    const after = rel.slice(root.length + 1);
    const top = after.split('/')[0];
    if (OWNED.includes(top)) return { root, tree: top };
    if (after === 'analysis_options.yaml' || after === 'dart_test.yaml') return { root, tree: '.' };
  }
  return null;
}

const dartFiles = [];
const optionFiles = [];
const testConfigFiles = [];
const rootsSeen = new Set();
/** Tracked but not on disk — see `onDisk` below. Printed, never silent. */
const missing = [];
/**
 * 🔴 TRACKED IS NOT THE SAME AS PRESENT, AND THE GAP IS ROUTINE RATHER THAN
 * EXOTIC. The domain comes from `git ls-files`, which lists what the INDEX
 * knows; a file deleted in the working tree and not yet staged is still on that
 * list. That is the exact state `git apply` of any deletion-bearing patch
 * leaves behind, and it is what a half-finished rebase looks like too.
 *
 * Before this filter every clause below did a bare `readFileSync` and the guard
 * died on the first such path with an unhandled
 * `Error: ENOENT … consent_prompt.dart` and exit 1 — reproduced 2026-08-10 by
 * deleting one tracked file without staging it. Exit 1 with a Node stack is
 * indistinguishable at a glance from a real gate-weakening failure, and it cost
 * a reviewer a false positive: red before `git add -A`, green after.
 *
 * Skipping is safe BECAUSE the coverage assertions below are set against the
 * scan, not against the index: a file that genuinely leaves the tree still has
 * to move REQUIRED_COVERAGE, so this cannot become a way to hide one.
 */
const onDisk = (rel) => {
  if (existsSync(join(ROOT, rel))) return true;
  missing.push(rel);
  return false;
};
for (const rel of tracked) {
  const c = classify(rel);
  if (!c) continue;
  if (!onDisk(rel)) continue;
  rootsSeen.add(c.root);
  if (rel.endsWith('.dart')) dartFiles.push({ rel, ...c });
  else if (rel.endsWith('/analysis_options.yaml')) optionFiles.push({ rel, ...c });
  else if (rel.endsWith('/dart_test.yaml')) testConfigFiles.push({ rel, ...c });
}
if (missing.length) {
  console.log(
    `note ${missing.length} tracked path(s) are not on disk and were skipped ` +
      `(${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}). This is what a deletion applied but ` +
      'not yet staged looks like. The per-root floors below see it if coverage really left — the REAL-APP ' +
      'anchor and floor specifically, not the union count, which the brick alone satisfies. ' +
      '⚠️ That sentence read "the REQUIRED_COVERAGE floors below still see it" until 2026-08-17 and was ' +
      'FALSE: deleting all of apps/ printed this very note for 117 paths and then exited 0.',
  );
}

if (dartFiles.length === 0) {
  coverageLost([
    'the scan found ZERO tracked Dart files under any app-owned tree.',
    `Trees looked at: ${OWNED.join(', ')} under ${BRICK_APP} and every apps/*.`,
    'Every clause below quantifies over that set; over an empty set they all report clean.',
  ]);
}
if (!rootsSeen.has(BRICK_APP)) {
  coverageLost([
    `the scan reached no file under ${BRICK_APP}.`,
    'The template is where a suppression reaches all fifty apps at once, so it is the one root that',
    'must always be covered. Either the brick moved and this guard did not follow, or the path is wrong.',
  ]);
}

// ── THE SYMMETRIC ANCHOR: at least one REAL app, not just the template ───────
//
// 🔴 THE BRICK ANCHOR ABOVE WAS THE ONLY PER-ROOT FLOOR, AND THAT MADE THE
// SHIPPED PRODUCT OPTIONAL. `dartFiles.length === 0` is a floor over the UNION
// of every root, and the brick contributes 26 tracked Dart files that no product
// change can remove — so `apps/` could empty COMPLETELY and both checks still
// held: the union was 26, not 0, and the one root that "must always be covered"
// was the one still there.
//
// MEASURED, on a copy of this repository (2026-08-17): delete `apps/` outright,
// leave the brick alone, and this guard printed
//   `ok  no gate weakening — 26 tracked Dart file(s) across 1 app root(s)
//    (tooling/bricks/…), … 0/1 allowlist entr(ies) still describe something real`
// and exited 0. 114 of 140 files left the scan, the allowlist self-check went
// quiet because the tree it describes was gone, and nothing was red. The note
// above even printed "117 tracked path(s) are not on disk and were skipped …
// the REQUIRED_COVERAGE floors below still see it if coverage really left" —
// which was FALSE as written, and is the sentence this block makes true.
//
// The brick is a CONSTANT and the apps are the VARIABLE; a floor that cannot
// tell them apart is measuring the constant.
const realAppRoots = [...rootsSeen].filter((r) => r !== BRICK_APP).sort();
const realAppDart = dartFiles.filter((f) => f.root !== BRICK_APP);
const brickDart = dartFiles.filter((f) => f.root === BRICK_APP);

/** Floors measured against THIS repository (114 real-app + 26 brick Dart files
 *  tracked on 2026-08-17), so they are applied only when ROOT is a full checkout
 *  of it — detected by this guard's own file, which sits outside `apps/` and the
 *  brick alike and so survives any mutation OF either. Fixtures legitimately
 *  model two files per root; the STRUCTURAL floor below applies everywhere. */
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-no-gate-weakening.mjs'));
const REAL_APP_FLOOR = 40;
const BRICK_FLOOR = 10;

if (realAppRoots.length === 0) {
  coverageLost([
    'the scan reached the brick template and NOT ONE real app under apps/.',
    'Every clause here is about an app opting ITSELF out of the factory rules. Over the template alone',
    'they are assertions about a directory nobody ships, and they pass whatever the shipped apps do.',
    `Trees looked at: ${OWNED.join(', ')} under each apps/*. The brick is a constant — it cannot stand in`,
    'for the variable, and a union floor that counts them together is measuring the constant.',
  ]);
}
if (IS_FULL_CHECKOUT && realAppDart.length < REAL_APP_FLOOR) {
  coverageLost([
    `only ${realAppDart.length} tracked Dart file(s) were scanned across apps/ (floor ${REAL_APP_FLOOR}), in ${realAppRoots.join(', ')}.`,
    'The roots are still there, so the anchor above is satisfied and only this floor sees it: a tree can',
    'lose almost all of its app code while still holding one file in one root. This repository tracked 114',
    'on 2026-08-17. If the apps really did shrink this far, move the floor in the same commit and say why.',
  ]);
}
if (IS_FULL_CHECKOUT && brickDart.length < BRICK_FLOOR) {
  coverageLost([
    `only ${brickDart.length} tracked Dart file(s) were scanned under ${BRICK_APP} (floor ${BRICK_FLOOR}).`,
    'The brick anchor above only asks whether ONE file was reached. This asks whether the template is still',
    'substantially in the scan — it tracked 26 on 2026-08-17 — because the template is the root where a',
    'single suppression reaches every future app at once.',
  ]);
}

// ── clauses 1 + 2: suppressions in Dart, checked against the allowlist ───────
const seenPairs = new Set();
for (const f of dartFiles) {
  const text = readFileSync(join(ROOT, f.rel), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    SUPPRESSION_RE.lastIndex = 0;
    let m;
    while ((m = SUPPRESSION_RE.exec(line)) !== null) {
      const fileLevel = m[1] !== undefined;
      const rules = m[2].split(',').map((r) => r.trim()).filter(Boolean);
      for (const rule of rules) {
        const key = `${f.rel}:${rule}`;
        seenPairs.add(key);
        if (ALLOWLIST.some((a) => a.file === f.rel && a.rule === rule)) continue;
        const blanket = /^type\s*=\s*lint$/.test(rule);
        fail(
          `${f.rel}:${i + 1} suppresses \`${rule}\`${fileLevel ? ' FOR THE WHOLE FILE' : ''} and is not on the allowlist.` +
            (blanket
              ? ' `ignore_for_file: type=lint` names NO rule, so it disables every one of them at once — the whole inherited set, for that file, silently.'
              : '') +
            ' An app that suppresses an inherited rule is exempt in practice while the include still looks correct,' +
            ' which is a fail-shape no other guard in the tree reports. Fix the code, or add a `file:rule`' +
            ' entry with a reason and a date — and delete it when the suppression goes, rather than widening it.',
        );
      }
    }
  });
}

// ── clauses 3 + 4: the app's own analyzer configuration ─────────────────────
let optionsChecked = 0;
for (const f of optionFiles) {
  optionsChecked++;
  const yaml = readFileSync(join(ROOT, f.rel), 'utf8').replace(/^\s*#.*$/gm, '');
  const lines = yaml.split('\n');
  const at = lines.findIndex((l) => /^analyzer:\s*$/.test(l));
  if (at === -1) continue;
  let inErrors = false;
  let inExclude = false;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break;
    if (/^\s{2}errors:\s*$/.test(line)) { inErrors = true; inExclude = false; continue; }
    if (/^\s{2}exclude:\s*$/.test(line) || /^\s{2}exclude:\s*\[/.test(line)) { inExclude = true; inErrors = false; continue; }
    if (/^\s{2}\S/.test(line)) { inErrors = false; inExclude = false; continue; }
    if (inErrors) {
      const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*ignore\s*$/);
      if (m) {
        const key = `${f.rel}:analyzer.errors.${m[1]}`;
        seenPairs.add(key);
        if (ALLOWLIST.some((a) => a.file === f.rel && a.rule === `analyzer.errors.${m[1]}`)) continue;
        fail(
          `${f.rel}:${i + 1} downgrades \`${m[1]}\` to \`ignore\` in its own analyzer block. That is the same ` +
            'opt-out as a file-level suppression, applied to the entire app at once, and it sits UNDER a ' +
            'perfectly correct `include:` where the inheritance guard cannot see it.',
        );
      }
    }
    if (inExclude) {
      const m = line.match(/^\s+-\s*(\S+)/);
      if (m) {
        const key = `${f.rel}:analyzer.exclude`;
        seenPairs.add(key);
        if (ALLOWLIST.some((a) => a.file === f.rel && a.rule === 'analyzer.exclude')) continue;
        fail(
          `${f.rel}:${i + 1} excludes \`${m[1]}\` from analysis. An excluded path is not analyzed at all — ` +
            'stronger than suppressing a rule, and invisible in every report that counts rules.',
        );
      }
    }
  }
}

// ── clause 5: skipped tests ─────────────────────────────────────────────────
for (const f of dartFiles) {
  if (!TEST_TREES.has(f.tree)) continue;
  const code = blankCommentsAndStrings(readFileSync(join(ROOT, f.rel), 'utf8'));
  code.split('\n').forEach((line, i) => {
    const m = SKIP_RE.exec(line);
    if (!m) return;
    const kind = m[1] ? 'skip:' : m[2] ? '@Skip(' : '@TestOn(';
    const key = `${f.rel}:${kind}`;
    seenPairs.add(key);
    if (ALLOWLIST.some((a) => a.file === f.rel && a.rule === kind)) return;
    fail(
      `${f.rel}:${i + 1} carries \`${kind}\`. A skipped test is a green test that asserts nothing, and the ` +
        'suite it belongs to is what every DoD item marked `lane` rests on. Zero were in tracked source when ' +
        'this guard landed, so every one from here is a deliberate, visible act.',
    );
  });
}

// ── clause 6: a per-app dart_test.yaml narrowing the suite ──────────────────
for (const f of testConfigFiles) {
  const key = `${f.rel}:dart_test.yaml`;
  seenPairs.add(key);
  if (ALLOWLIST.some((a) => a.file === f.rel && a.rule === 'dart_test.yaml')) continue;
  fail(
    `${f.rel} exists. A per-app dart_test.yaml can narrow which tests run — a platform filter, a tag ` +
      'selector, a timeout — without touching a single test file, so the suite shrinks and every count ' +
      'taken over it still reads full.',
  );
}

// ── the allowlist's own self-check, BOTH directions ─────────────────────────
// An entry nobody can find is either a suppression that was fixed (delete the
// entry) or a scan that no longer reaches the file (much worse). It cannot tell
// which, so it says both — and this is also what proves the scan still reaches
// apps/subly/live_probe, where the entire real baseline lives.
//
// ⚠️ AND IT IS SCOPED TO THE TREE THE ALLOWLIST DESCRIBES, derived rather than
// flagged. The entries name THIS repository's paths, so a fixture root — which
// legitimately has none of them — would otherwise fail every time, and the only
// ways to satisfy it would be to model this repo's live_probe in every fixture
// or to drop the check. The signal is the FILES: if a scanned root holds none of
// the allowlisted files at all, this is not the tree the allowlist is about, and
// that is PRINTED rather than passed over in silence. If any of them is present,
// every entry is checked — which is what makes "the suppression was removed and
// the entry stayed" a real, reachable red on the real repository.
const allowlistFilesPresent = ALLOWLIST.some((a) => a.file && existsSync(join(ROOT, a.file)));
let allowlistLive = 0;
for (const a of ALLOWLIST) {
  if (!a.file || !a.rule || !a.reason || !/^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '')) {
    fail(`allowlist entry ${JSON.stringify(a.file)}:${JSON.stringify(a.rule)} is missing a file, a rule, a reason or a YYYY-MM-DD date. An exception nobody wrote a reason for is an exception nobody can review.`);
    continue;
  }
  if (seenPairs.has(`${a.file}:${a.rule}`)) { allowlistLive++; continue; }
  if (!allowlistFilesPresent) continue;
  fail(
    `allowlist entry \`${a.file}:${a.rule}\` (recorded ${a.date}) matches NOTHING in the scanned tree. ` +
      'Either the suppression is gone — in which case delete the entry in the same change, because a ' +
      'licence nobody is watching is exactly what this guard exists to prevent — or this scan has stopped ' +
      'reaching that file, which would mean everything it reports is a clean sweep of somewhere else.',
  );
}
if (!allowlistFilesPresent && ALLOWLIST.length > 0) {
  console.log(
    `⬜ none of the ${ALLOWLIST.length} allowlisted file(s) exist under ${ROOT}, so the stale-entry check was ` +
      'NOT performed here — this is not the tree the allowlist describes. Printed rather than implied.',
  );
}

if (problems.length) {
  console.error(`FAIL gate weakening — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-4] C-12 makes the rule set REACH every app; this makes sure no app hollows it');
  console.error('  out locally. Both can be true of the tree while one app is exempt in practice.');
  console.error('\nassert-no-gate-weakening: FAILED');
  process.exit(1);
}

// 🔴 THE PASSING LINE SPLITS THE BRICK OUT FROM THE REAL APPS. It used to print
// one total and a root list — "140 tracked Dart file(s) across 2 app root(s)" —
// and the identical sentence shape read "26 … across 1 app root(s)" with every
// shipped app deleted. A reader checking coverage from that line had no way to
// see that the surviving root was the template. The split cannot say that.
console.log(
  `ok  no gate weakening — ${dartFiles.length} tracked Dart file(s) ` +
    `[apps=${realAppDart.length}${IS_FULL_CHECKOUT ? `/floor ${REAL_APP_FLOOR}` : ''} in ${realAppRoots.length} real root(s): ${realAppRoots.join(', ') || 'none'}; ` +
    `brick=${brickDart.length}${IS_FULL_CHECKOUT ? `/floor ${BRICK_FLOOR}` : ''}], ${optionsChecked} analysis_options.yaml, ` +
    `${testConfigFiles.length} dart_test.yaml; 6 clauses, detectors self-tested first; ` +
    `${allowlistLive}/${ALLOWLIST.length} allowlist entr(ies) still describe something real. ` +
    'Clause 7 (an app deleting its inherited property test) is assert-stamp-properties.mjs, which reads apps/* too.' +
    (IS_FULL_CHECKOUT
      ? ''
      : ' NOTE: this root is not a checkout of this repository, so the numeric floors were NOT applied — only' +
        ' the structural anchors (the brick reached, and at least one real app root reached) ran here.'),
);
