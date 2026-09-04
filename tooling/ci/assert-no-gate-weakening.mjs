#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-gate-weakening.mjs — [pipeline N-4] no SHIPPED DART TREE opts itself
// out of the factory's enforcement.
//
// ⚠️ THE SUBJECT IS THE SHIPPED DART, NOT "AN APP". This guard said "no app" for
// its first five weeks and its domain was `apps/*` plus the brick, which is a
// smaller guard than the sentence deserved and, after ADR 065 chassis step 2,
// a materially smaller one than the product. See "SCOPE" below: `packages/` is
// where the chassis now lives, every line of it compiles into every app a user
// installs, and it was invisible here. The header has been rewritten to say what
// the code does rather than what it used to do.
//
// THE SEAM, stated so it does not swallow a neighbour: C-12 owns "the rule set
// REACHES every app" (`assert-lint-inheritance.mjs` checks the include is there).
// N-4 owns "no shipped tree HOLLOWS IT OUT locally". Both can be true of the tree
// while one app — or one shared package linked by every app — is exempt in
// practice, and that fail-shape is reported by nothing else: every stage-1 and
// stage-2 guard checks that the checks exist, not that a tree opted out of them
// underneath a perfectly correct include.
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
// exactly that. And suppressing a rule that is NOT inherited is still a tree
// deciding for itself which analysis applies to it. So: every `// ignore:` and
// every `// ignore_for_file:` in a scanned Dart tree is allowlisted with a
// reason, or it fails. Strictly stronger, and one scanner instead of two.
//
// ── SCOPE: TRACKED FILES, THREE ROOT KINDS, FIVE TREES ───────────────────────
// `git ls-files`, never a filesystem walk. `apps/subly/.dart_tool/dartpad/
// web_plugin_registrant.dart` carries `ignore_for_file: type=lint` and is
// GENERATED — a walk would fail the build on a file nobody wrote. The trees
// scanned inside each root are `lib/`, `test/`, `integration_test/`,
// `test_driver/` and `live_probe/`; the drafted scope missed the last of those,
// which is where BOTH of apps/subly's real suppressions live.
//
// The ROOTS are of three kinds, and each carries its own floor because each can
// collapse without the others noticing:
//
//   apps/*                     — the shipped apps
//   packages/*                 — the shared chassis every app links
//   tooling/bricks/…/{{app_id}} — the template every future app is born from
//
// ── 🔴 WHY `packages/` IS HERE, AND WHY "AN APP OWNS IT" WAS THE WRONG TEST ──
// This guard's own criterion used to be "the trees an APP owns", and on that
// wording `packages/` is out: a package is not an app. That wording was wrong,
// and the honest test is THE ONE THIS GUARD'S HARM MODEL ALREADY USES — does the
// Dart in this tree ship, and can one suppression in it exempt code that reaches
// users? The brick has never been an app either; it is in scope precisely because
// "one edit here reaches all fifty apps at once". `packages/` is the same
// argument with a shorter fuse: its Dart is COMPILED INTO every app a user
// installs TODAY, not into apps not yet stamped.
//
// MEASURED on main 4ab17a24, 2026-09-05, before this change:
//   · `git ls-files -- packages` → 181 tracked .dart, NONE of them in this
//     guard's domain. 180 of those sit in `lib/` and `test/` (the 181st is
//     `packages/core/tool/`, a dev script that ships to nobody and stays out).
//   · FIVE `// ignore:` suppressions already lived there, allowlisted by
//     nothing, reviewed by nothing.
//   · TWO `@TestOn(` annotations in `packages/core/test/` — clause 5's subject —
//     equally unwatched.
//   · TEN `analysis_options.yaml` files this guard had never opened, one of
//     which is `packages/analysis/lib/analysis_options.yaml`: THE SHARED RULE
//     SET ITSELF, carrying an `analyzer.exclude` block.
//   · And nothing else covers it: `assert-no-tls-pinning.mjs` and
//     `assert-no-clone-tells.mjs` both read `packages/`, for TLS trust and for
//     clone tells; a grep of `tooling/ci/*.mjs` for `ignore_for_file` on
//     2026-09-05 returned this file and no other. The suppression fail-shape
//     under `packages/` was owned by nobody.
//
// `services/`, `sites/` and `catalog/` are deliberately NOT here, and that is a
// measurement rather than an oversight: on 2026-09-05 the only tracked `.dart`
// outside `apps/`, `packages/` and the brick were four files under
// `tooling/ci/test/fixtures/`, which are inputs to other guards' tests and are
// SUPPOSED to be dirty. A root with no shipped Dart in it would add a floor that
// measures nothing.
//
// ── MUTATION TABLE — RUN 2026-09-05, not read off the source ─────────────────
// Reading a guard under-reports what it covers, so every row below was executed
// against this tree and restored (`git checkout -- packages` after each; the
// working tree was verified clean between rows). Baseline exit 0, printing
//   `ok  no gate weakening — 354 tracked Dart file(s) [apps=148/floor 40 in 1
//    real root(s): apps/subly; packages=180/floor 60 in 9 package root(s);
//    brick=26/floor 10], 12 analysis_options.yaml, … 6/6 allowlist entr(ies)`
// against 174 / 2 analysis_options / 1 allowlist entry before the change.
//
//   mutation                                            exit before → after
//   ─────────────────────────────────────────────────── ───────────────────
//   plant `// ignore: avoid_print` in
//     packages/design_system/lib/nikatru_design_system.dart   0 → 1  clause 1
//   plant `// ignore_for_file: type=lint` in
//     packages/core/lib/src/entitlement_cache.dart           0 → 1  clause 2
//   add `analyzer: errors: avoid_print: ignore` to
//     packages/core/analysis_options.yaml                    0 → 1  clause 3
//   add `analyzer: exclude: - lib/generated/**` to
//     packages/core/analysis_options.yaml                    0 → 1  clause 4
//   add `skip: true` to packages/core/test/…                 0 → 1  clause 5
//   delete `packages/`, unstaged                            0 → 1  COVERAGE LOST
//                                        "the scan reached NOT ONE package"
//   thin `packages/` to ONE tracked .dart                   0 → 1  COVERAGE LOST
//                                        "only 1 … (floor 60)"
//   delete the `// ignore:` lines the telemetry-test
//     allowlist entry excuses                               0 → 1  stale entry
//   ── and the three that must NOT move ──────────────────────────────────────
//   delete packages/design_system entirely                  0 → 0  THE CONTROL
//                                        packages=140/floor 60, still green
//   plant `// ignore:` in services/…/lib, git-added         0 → 0  out of scope
//   plant `// ignore:` in packages/core/tool/…              0 → 0  out of scope
//
// The three zero-rows are the half that keeps this guard alive. A floor that
// fires on an honest shrink gets switched off within a week; deleting a whole
// package is an honest shrink, and `tool/` and `services/` are not shipped Dart.
// The stale-entry row is the direction people forget: the allowlist fails when an
// entry stops matching, so these entries cannot outlive what they excuse.
//
// ── ⚠️ ONE CONSEQUENCE FOR WHOEVER RUNS A LOCAL `pub get` ────────────────────
// `tooling/versions.json` records that under Flutter 3.47 EVERY `flutter pub get`
// rewrites `analysis_options.yaml`, appending an `analyzer: exclude:` block for
// build/ and the six platform directories, and that committing it fails clause 4
// here — "revert those seven files after any local pub get". That instruction is
// now UNDER-COUNTED: this guard read 2 analysis_options.yaml before this change
// and reads 12 after, so the ten under `packages/` join the set a pub get can
// make red. The CI argument is unchanged and still holds — this guard runs in the
// `platform` job, every pub get runs in `app_brick`/`workspace_gate`, different
// runners and fresh checkouts — but the local-workflow note in versions.json
// needs its count widened, and that file is not this one to edit.
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
/** A shipped root is `apps/<name>`, `packages/<name>`, or the brick template.
 *  Kept as data rather than as three code paths so the per-root floors below can
 *  be stated once per KIND and nobody can add a root without a floor. */
const APP_RE = /^(apps\/[^/]+)\//;
const PACKAGE_RE = /^(packages\/[^/]+)\//;
/** The Dart trees scanned inside each root. `live_probe/` is on this list because
 *  it is where apps/subly's whole baseline lives and the drafted scope did not
 *  reach it. `tool/` is NOT: `packages/core/tool/` is a dev script that ships to
 *  nobody, and a floor over code that does not ship measures the wrong thing. */
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

  // ── the packages/ baseline, recorded when ADR 065 chassis step 3 brought the
  //    shared shelf into this guard's domain. Every one of these was READ before
  //    it was excused; none is a "make it green" entry.
  {
    file: 'packages/telemetry/lib/src/telemetry_bootstrap.dart',
    rule: 'deprecated_member_use',
    date: '2026-09-05',
    reason:
      'the PII scrubber reads and rewrites `SentryEvent.extra`, which the Sentry SDK deprecated in favour ' +
      'of `contexts`. The field is still SERIALIZED AND STILL REACHES THE SERVER, so an event carrying a ' +
      'phone number in `extra` is a real privacy leak whether or not the SDK likes the name — scrubbing it ' +
      'is the whole point of the hook. Dropping the suppression means deleting the scrub, which is a ' +
      'privacy regression; the correct close is the SDK removing the field, at which point this stops ' +
      'compiling and the entry goes with it. (Two sites: the read and the write-back of the same field.)',
  },
  {
    file: 'packages/telemetry/test/telemetry_bootstrap_test.dart',
    rule: 'deprecated_member_use',
    date: '2026-09-05',
    reason:
      'the test for the scrub above has to CONSTRUCT an event with a dirty `extra` and then read it back, ' +
      'so it touches the same deprecated field the production code does. A test that could not name the ' +
      'field could not prove the leak is closed, and an unproven scrub is worse than a deprecation ' +
      'warning. Closes with the entry above, in the same change.',
  },
  {
    file: 'packages/core/test/content_pack_fixture_test.dart',
    rule: '@TestOn(',
    date: '2026-09-05',
    reason:
      '`@TestOn(\'vm\')` here REMOVES NO COVERAGE — `dart test` defaults to the VM, so the VM lane still ' +
      'runs every case. It exists because workspace_gate also runs `dart test -p chrome` over this package ' +
      'for the GPC web arm, and there an unannotated `dart:io` test is a COMPILE FAILURE rather than a ' +
      'skip. The annotation states the platform the file was always about. (K-15.)',
  },
  {
    file: 'packages/core/test/privacy_signal_browser_test.dart',
    rule: '@TestOn(',
    date: '2026-09-05',
    reason:
      '`@TestOn(\'browser\')` ADDS coverage rather than removing it: this is the only test that executes ' +
      'privacy_signal_web.dart in a real browser, and it is checking the truthy-string trap where JS ' +
      '"false" opts a user OUT of GPC. No Dart double can produce a JS string in a JSAny slot, so the case ' +
      'is unassertable on the VM; the annotation routes it to the chrome lane instead of failing the VM ' +
      'lane. (K-15.)',
  },
  {
    file: 'packages/analysis/lib/analysis_options.yaml',
    rule: 'analyzer.exclude',
    date: '2026-09-05',
    reason:
      'this file IS the shared rule set — the one every app and package inherits — not a tree opting out ' +
      'of it, and `assert-lint-inheritance.mjs` already treats it as the SHARED constant for the same ' +
      'reason. Its exclude list is `**/*.g.dart` and `**/*.freezed.dart`: GENERATED output nobody wrote, ' +
      'the same class of file this guard refuses to walk. Note clause 4 keys on the FILE, so this one ' +
      'entry covers both globs — widening the list here is invisible to this entry, which is why clause 3 ' +
      'is deliberately left live on this file: demoting a rule to `ignore` in the shared set would still ' +
      'be red, and that is the weakening that matters.',
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

// ── the domain: TRACKED files under the brick + every apps/* and packages/* ──
const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', 'apps', 'packages', BRICK_APP], { encoding: 'utf8' });
if (ls.status !== 0) {
  coverageLost([
    '`git ls-files -- apps packages <brick app>` failed, so the tracked-file domain is unreadable.',
    'A filesystem walk is NOT the fallback: the generated apps/subly/.dart_tool/dartpad/',
    'web_plugin_registrant.dart carries `ignore_for_file: type=lint`, and failing the build on a file',
    'nobody wrote is how a guard gets switched off.',
  ]);
}
const tracked = ls.stdout.split('\n').map((l) => l.trim()).filter(Boolean);

/** Which root, of which KIND, and which scanned tree a path belongs to, or null.
 *  The kind is what the per-root floors below are grouped by: an app, a shared
 *  package, and the brick template each collapse independently, so a count that
 *  merges any two of them is a union floor wearing a different name. */
function classify(rel) {
  const roots = [{ root: BRICK_APP, kind: 'brick' }];
  const a = rel.match(APP_RE);
  if (a) roots.push({ root: a[1], kind: 'app' });
  const p = rel.match(PACKAGE_RE);
  if (p) roots.push({ root: p[1], kind: 'package' });
  for (const { root, kind } of roots) {
    if (!rel.startsWith(`${root}/`)) continue;
    const after = rel.slice(root.length + 1);
    const top = after.split('/')[0];
    if (OWNED.includes(top)) return { root, kind, tree: top };
    if (after === 'analysis_options.yaml' || after === 'dart_test.yaml') return { root, kind, tree: '.' };
  }
  return null;
}

const dartFiles = [];
const optionFiles = [];
const testConfigFiles = [];
/** root → kind ('app' | 'package' | 'brick'). A Set of names cannot answer "did
 *  any PACKAGE root survive", which is exactly the question a union floor fails. */
const rootsSeen = new Map();
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
  rootsSeen.set(c.root, c.kind);
  if (rel.endsWith('.dart')) dartFiles.push({ rel, ...c });
  else if (rel.endsWith('/analysis_options.yaml')) optionFiles.push({ rel, ...c });
  else if (rel.endsWith('/dart_test.yaml')) testConfigFiles.push({ rel, ...c });
}
if (missing.length) {
  console.log(
    `note ${missing.length} tracked path(s) are not on disk and were skipped ` +
      `(${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}). This is what a deletion applied but ` +
      'not yet staged looks like. The per-root floors below see it if coverage really left — the REAL-APP ' +
      'and PACKAGE anchors and floors specifically, not the union count, which the brick alone satisfies. ' +
      '⚠️ That sentence read "the REQUIRED_COVERAGE floors below still see it" until 2026-08-17 and was ' +
      'FALSE: deleting all of apps/ printed this very note for 117 paths and then exited 0.',
  );
}

if (dartFiles.length === 0) {
  coverageLost([
    'the scan found ZERO tracked Dart files under any scanned tree.',
    `Trees looked at: ${OWNED.join(', ')} under ${BRICK_APP}, every apps/* and every packages/*.`,
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
// 🔴 AND THE SAME ARGUMENT MADE `packages/` OPTIONAL UNTIL 2026-09-05. ADR 065
// chassis step 2 moved the generic chassis into `packages/`, which is Dart that
// compiles into every installed app — and this guard's domain was `apps` plus the
// brick, so `git ls-files -- packages` returned 181 tracked .dart files, NONE of
// them scanned here. Five real suppressions, two `@TestOn(` annotations and ten
// analysis_options.yaml files sat outside every count this guard printed, and the
// passing line said "no gate weakening" over all of them. A third root kind, a
// third anchor, a third floor — never a fourth number folded into an existing one.
const rootsOfKind = (kind) => [...rootsSeen].filter(([, k]) => k === kind).map(([r]) => r).sort();
const realAppRoots = rootsOfKind('app');
const packageRoots = rootsOfKind('package');
const realAppDart = dartFiles.filter((f) => f.kind === 'app');
const packageDart = dartFiles.filter((f) => f.kind === 'package');
const brickDart = dartFiles.filter((f) => f.kind === 'brick');

/** Floors measured against THIS repository — 148 real-app + 180 package + 26
 *  brick Dart files tracked on 2026-09-05 — so they are applied only when ROOT is
 *  a full checkout of it, detected by this guard's own file, which sits outside
 *  `apps/`, `packages/` and the brick alike and so survives any mutation OF any of
 *  them. Fixtures legitimately model two files per root; the STRUCTURAL anchors
 *  below apply everywhere.
 *
 *  ⚠️ The apps figure was 114 when these floors were set on 2026-08-17 and is 148
 *  today; the floor of 40 was never touched and is not touched here either, so
 *  that it keeps meaning "this tree has collapsed" rather than "this tree changed
 *  this week". The same reasoning sets the packages floor at a third of what is
 *  there, matching `assert-no-clone-tells.mjs`, which floors the same tree at 60. */
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-no-gate-weakening.mjs'));
const REAL_APP_FLOOR = 40;
const PACKAGE_FLOOR = 60;
const BRICK_FLOOR = 10;

if (realAppRoots.length === 0) {
  coverageLost([
    'the scan reached the brick template and NOT ONE real app under apps/.',
    'Every clause here is about a shipped tree opting ITSELF out of the factory rules. Over the template',
    'alone they are assertions about a directory nobody ships, and they pass whatever the apps do.',
    `Trees looked at: ${OWNED.join(', ')} under each apps/*. The brick is a constant — it cannot stand in`,
    'for the variable, and a union floor that counts them together is measuring the constant.',
  ]);
}
if (packageRoots.length === 0) {
  coverageLost([
    'the scan reached NOT ONE package under packages/.',
    'That is the shared chassis ADR 065 step 2 moved the generic code into, and its Dart compiles into',
    'every app a user installs — a suppression there reaches more shipped code than one in any single app.',
    `Trees looked at: ${OWNED.join(', ')} under each packages/*. Neither the apps nor the brick can vouch`,
    'for it: on 2026-09-05 this guard scanned 174 files and none of them was under packages/.',
  ]);
}
if (IS_FULL_CHECKOUT && realAppDart.length < REAL_APP_FLOOR) {
  coverageLost([
    `only ${realAppDart.length} tracked Dart file(s) were scanned across apps/ (floor ${REAL_APP_FLOOR}), in ${realAppRoots.join(', ')}.`,
    'The roots are still there, so the anchor above is satisfied and only this floor sees it: a tree can',
    'lose almost all of its app code while still holding one file in one root. This repository tracked 114',
    'on 2026-08-17 and 148 on 2026-09-05. If the apps really did shrink this far, move the floor in the',
    'same commit and say why.',
  ]);
}
if (IS_FULL_CHECKOUT && packageDart.length < PACKAGE_FLOOR) {
  coverageLost([
    `only ${packageDart.length} tracked Dart file(s) were scanned across packages/ (floor ${PACKAGE_FLOOR}), in ${packageRoots.join(', ')}.`,
    'The package roots still exist, so the anchor above is satisfied and only this floor sees it. This',
    'repository tracked 180 in packages/*/lib and packages/*/test on 2026-09-05, and the floor is set at a',
    'third of that so an honest shrink — retiring a whole package — clears it and only a collapse does not.',
    'If the chassis really did shrink this far, move the floor in the same commit and say why.',
  ]);
}
if (IS_FULL_CHECKOUT && brickDart.length < BRICK_FLOOR) {
  coverageLost([
    `only ${brickDart.length} tracked Dart file(s) were scanned under ${BRICK_APP} (floor ${BRICK_FLOOR}).`,
    'The brick anchor above only asks whether ONE file was reached. This asks whether the template is still',
    'substantially in the scan — it tracked 26 on 2026-08-17 and on 2026-09-05 — because the template is',
    'the root where a single suppression reaches every future app at once.',
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
            (f.kind === 'package'
              ? ' This is a SHARED package: its Dart compiles into every app a user installs, so one suppression' +
                ' here exempts more shipped code than one in any single app.'
              : '') +
            ' A tree that suppresses an inherited rule is exempt in practice while the include still looks correct,' +
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
            `opt-out as a file-level suppression, applied to the whole ${f.kind === 'package' ? 'package' : 'app'} at once, and it sits UNDER a ` +
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
        'suite it belongs to is what every DoD item marked `lane` rests on. ' +
        '⚠️ This sentence read "Zero were in tracked source when this guard landed" until 2026-09-05, which ' +
        'was true only because the scan stopped at apps/: bringing packages/ in found TWO `@TestOn(` ' +
        'annotations in packages/core/test that had never been looked at. Both are allowlisted with reasons ' +
        'above. Every one from here is a deliberate, visible act, which is why this one has to be named.',
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
// or to drop the check.
//
// 🔴 THE SCOPING RULE CHANGED ON 2026-09-05 AND THE OLD ONE WOULD HAVE GONE
// SILENTLY WRONG. It was "if ANY allowlisted file is present, check EVERY entry".
// With one entry that is the same thing as checking it; with nine spread across
// apps/ and packages/ it is not, and it fails a fixture that models one of them
// honestly — which is how a check gets loosened by whoever has to make the suite
// green. So:
//
//   · on a checkout of THIS repository — the tree the allowlist is literally
//     about, detected by the same sentinel the floors use — EVERY entry is
//     checked, present file or not. That keeps the strongest case: closing a
//     suppression by deleting the whole file and leaving the entry behind is
//     still red, and so is the scan quietly stopping short of that file.
//   · anywhere else, an entry whose file is not in the tree is not about this
//     tree; it is SKIPPED and PRINTED, never passed over in silence. An entry
//     whose file IS present is checked exactly as before, which is what keeps
//     "the suppression was removed and the entry stayed" reachable in a fixture.
let allowlistLive = 0;
const allowlistSkipped = [];
for (const a of ALLOWLIST) {
  if (!a.file || !a.rule || !a.reason || !/^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '')) {
    fail(`allowlist entry ${JSON.stringify(a.file)}:${JSON.stringify(a.rule)} is missing a file, a rule, a reason or a YYYY-MM-DD date. An exception nobody wrote a reason for is an exception nobody can review.`);
    continue;
  }
  if (seenPairs.has(`${a.file}:${a.rule}`)) { allowlistLive++; continue; }
  if (!IS_FULL_CHECKOUT && !existsSync(join(ROOT, a.file))) { allowlistSkipped.push(`${a.file}:${a.rule}`); continue; }
  fail(
    `allowlist entry \`${a.file}:${a.rule}\` (recorded ${a.date}) matches NOTHING in the scanned tree. ` +
      'Either the suppression is gone — in which case delete the entry in the same change, because a ' +
      'licence nobody is watching is exactly what this guard exists to prevent — or this scan has stopped ' +
      'reaching that file, which would mean everything it reports is a clean sweep of somewhere else.',
  );
}
if (allowlistSkipped.length) {
  console.log(
    `⬜ ${allowlistSkipped.length} of ${ALLOWLIST.length} allowlisted file(s) do not exist under ${ROOT}, so ` +
      'the stale-entry check was NOT performed here for them — this is not the tree those entries describe. ' +
      `Printed rather than implied: ${allowlistSkipped.slice(0, 3).join(', ')}` +
      `${allowlistSkipped.length > 3 ? ', …' : ''}`,
  );
}

if (problems.length) {
  console.error(`FAIL gate weakening — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-4] C-12 makes the rule set REACH every app; this makes sure no SHIPPED DART TREE');
  console.error('  — apps/*, packages/* or the brick — hollows it out locally. Both can be true of the tree');
  console.error('  while one app, or one package every app links, is exempt in practice.');
  console.error('\nassert-no-gate-weakening: FAILED');
  process.exit(1);
}

// 🔴 THE PASSING LINE SPLITS EVERY ROOT KIND OUT. It used to print one total and
// a root list — "140 tracked Dart file(s) across 2 app root(s)" — and the
// identical sentence shape read "26 … across 1 app root(s)" with every shipped
// app deleted. A reader checking coverage from that line had no way to see that
// the surviving root was the template. The split cannot say that, and the
// `packages=` term is here for the same reason: on 2026-09-05 this line read
// "174 tracked Dart file(s)" while 181 tracked .dart under packages/ were not in
// the scan at all, and nothing in the sentence said so.
console.log(
  `ok  no gate weakening — ${dartFiles.length} tracked Dart file(s) ` +
    `[apps=${realAppDart.length}${IS_FULL_CHECKOUT ? `/floor ${REAL_APP_FLOOR}` : ''} in ${realAppRoots.length} real root(s): ${realAppRoots.join(', ') || 'none'}; ` +
    `packages=${packageDart.length}${IS_FULL_CHECKOUT ? `/floor ${PACKAGE_FLOOR}` : ''} in ${packageRoots.length} package root(s); ` +
    `brick=${brickDart.length}${IS_FULL_CHECKOUT ? `/floor ${BRICK_FLOOR}` : ''}], ${optionsChecked} analysis_options.yaml, ` +
    `${testConfigFiles.length} dart_test.yaml; 6 clauses, detectors self-tested first; ` +
    `${allowlistLive}/${ALLOWLIST.length} allowlist entr(ies) still describe something real. ` +
    'Clause 7 (an app deleting its inherited property test) is assert-stamp-properties.mjs, which reads apps/* too.' +
    (IS_FULL_CHECKOUT
      ? ''
      : ' NOTE: this root is not a checkout of this repository, so the numeric floors were NOT applied — only' +
        ' the structural anchors (the brick reached, at least one real app root reached, and at least one' +
        ' package root reached) ran here.'),
);
