#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-version-consistency.mjs — one declaration, and nothing may disagree.
//
// The Flutter version was written in SIX places and `node-version: 24` in EIGHT,
// across five workflows and a shell script whose comment read "keep in lockstep
// with *.yml" — a maintenance instruction addressed to a human. Bump one, miss
// another, and that lane silently builds on a different SDK while the code looks
// identical.
//
// `mason_cli` was pinned NOWHERE. Mason is what stamps apps, so an unpinned
// mason means the factory's product could differ run to run with nothing in the
// repo to explain it.
//
// GitHub Actions cannot interpolate a file into `with:`, so the values are still
// written at each call site. What this guard removes is the SILENT miss.
//
// Pipeline requirement: Private/requirements/ → F-2.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/assert-version-consistency.mjs [repoRoot]
// Exit 0 = every literal matches tooling/versions.json, 1 = drift.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';

const repoRoot = process.argv[2] ?? process.cwd();
const declPath = join(repoRoot, 'tooling', 'versions.json');

if (!existsSync(declPath)) {
  console.error(`✗ no tooling/versions.json under ${repoRoot} — nothing to check against`);
  process.exit(1);
}
const decl = JSON.parse(readFileSync(declPath, 'utf8'));

/** Each rule finds every occurrence of a versioned thing and reports the value
 *  it names, so the guard compares PARSED values rather than grepping for the
 *  expected string. Grepping for the right answer can only ever find sites that
 *  are already correct — it can never see the one that drifted. */
const RULES = [
  { key: 'flutter', label: 'Flutter', re: /flutter-version:\s*'?([0-9][^\s'"#]*)'?/g },
  { key: 'flutter', label: 'Flutter', re: /FLUTTER_VERSION[:=]\s*'?"?([0-9][^\s'"#]*)'?"?/g },
  { key: 'node', label: 'Node', re: /node-version:\s*'?([0-9][^\s'"#]*)'?/g },
  { key: 'java', label: 'Java', re: /java-version:\s*'?([0-9][^\s'"#]*)'?/g },
  // 🔴 THE JAVA PIN IS WRITTEN IN EIGHT PLACES AND THE RULE ABOVE SAW THREE.
  // Mutation-proven on the REAL tree 2026-08-17: setting `java` to "21" in
  // versions.json named build-platforms.yml:209 and submit-play.yml:180,297 —
  // and said nothing at all about the five literals below.
  // The workflow input only chooses which JDK is INSTALLED. These choose what is
  // actually PRODUCED: the Gradle pair fixes the class-file version of every
  // Android build, the Kotlin one fixes the JVM target of the Kotlin half, and
  // wsl-setup.sh fixes which JDK a LOCAL Android build runs on at all (CLAUDE.md:
  // Android builds in WSL, never on the Windows host). A pin visible only where
  // the toolchain is installed agrees with itself while the compiler emits
  // something else, which is the exact failure F-2 exists to make impossible.
  // Gradle's legacy `VERSION_1_8` spelling captures `1_8`, not `1`: the guard
  // must report the literal somebody wrote, never a truncation of it.
  { key: 'java', label: 'Java (Gradle compileOptions)', re: /(?:source|target)Compatibility\s*=\s*JavaVersion\.VERSION_([0-9][0-9_]*)/g },
  { key: 'java', label: 'Java (Kotlin jvmTarget)', re: /JvmTarget\.JVM_([0-9][0-9_]*)/g },
  { key: 'java', label: 'Java (WSL JDK path)', re: /java-([0-9]+)-openjdk/g },
  { key: 'java', label: 'Java (WSL apt package)', re: /openjdk-([0-9]+)-jdk/g },
  { key: 'melos', label: 'Melos', re: /dart pub global activate melos\s+([0-9][^\s'"#]*)/g },
  // The THIRD melos declaration — the workspace root's own dev_dependency —
  // which no rule reached until 2026-08-17 (mutating the pin named ci.yml
  // alone). It is not a duplicate of the line above: that one is the melos CI
  // ACTIVATES, this one is the melos `melos run gate` RESOLVES, and §14 defines
  // green as the second. Anchored to a whole line so a `run:` block mentioning
  // melos cannot match, and the value must start with a digit or a range
  // operator so the bare `melos:` config key further down the file cannot.
  // Captured WHOLE, for the reason spelled out on the brick rule below: a caret
  // must come back unequal to the exact pin, never be quietly stripped.
  { key: 'melos', label: 'Melos (workspace dev_dependency)', re: /^\s+melos:\s*([\^~<>=0-9][^\s'"#]*)\s*$/g },
  { key: 'mason_cli', label: 'mason_cli', re: /dart pub global activate mason_cli\s*([^\s'"#]*)/g },
  // Runner images. A `-latest` label is a moving target in exactly the way a
  // floating action tag is: macos-latest rolling to a new Xcode changes what an
  // identical commit builds, with no diff in the repo. Matched per-OS so the
  // error can name the expected label rather than just "not pinned".
  { key: 'wrangler', label: 'Wrangler', re: /wranglerVersion:\s*'?([0-9][^\s'"#]*)'?/g },
  // A dependency SPEC, not a workflow input. 🔴 THE WHOLE STRING is captured —
  // review 2026-07-31 (mutation-proven): the first version put `\^?` OUTSIDE
  // the capture, so `"^4.114.0"` captured `4.114.0`, equalled the declared pin
  // and PASSED — a caret wrapping the current version floated silently, which
  // is the exact PR #79 incident reproduced green, while the comment here
  // claimed the opposite. Now any range operator makes the captured string
  // unequal to the exact pin and fails.
  { key: 'wrangler', label: 'Wrangler (brick dep)', re: /"wrangler":\s*"([^"]+)"/g },
  { key: 'runner_ubuntu', label: 'Ubuntu runner', re: /runs-on:\s*(ubuntu-[^\s'"#]+)/g },
  { key: 'runner_windows', label: 'Windows runner', re: /runs-on:\s*(windows-[^\s'"#]+)/g },
  { key: 'runner_macos', label: 'macOS runner', re: /runs-on:\s*(macos-[^\s'"#]+)/g },
];

/** Files that may name a build version. */
const TARGETS = [];
const wfDir = join(repoRoot, '.github', 'workflows');
if (existsSync(wfDir)) {
  for (const f of listDir(wfDir).filter((x) => x.endsWith('.yml') || x.endsWith('.yaml'))) {
    TARGETS.push(join('.github', 'workflows', f));
  }
}
// 🔴 REQUIRED, NEVER existsSync-GATED — and this is the BRICK_PKG lesson below
// being paid for a second time. Both of these landed `if (existsSync)` on
// 2026-08-17 and the hole was mutation-proven the same day: HIDING
// apps/subly/android/app/build.gradle.kts made this guard print
// `ok  version consistency — 85 reference(s) across 14 file(s)` and exit 0,
// against 88/15 with the file present. It passed having checked LESS, which is
// the one outcome a coverage guard may never produce.
// What each carries: `pubspec.yaml` holds the melos dev_dependency that
// `melos run gate` actually resolves; `README.md`'s build block holds the
// `dart pub global activate melos <version>` a contributor copy-pastes — a real
// call site, read by the same rule that reads ci.yml, and unguarded until now.
// (No line number on purpose. A `README.md:38` here would be correct only until
// somebody inserts a paragraph above it, and nothing recomputes it — the exact
// citation rot CLAUDE.md records for `ci.yml:NNNN`. The REQUIRED_YIELD entry
// below is the durable version of the same assertion: it re-finds the line.)
for (const rel of ['pubspec.yaml', 'README.md']) {
  if (!existsSync(join(repoRoot, rel))) {
    console.error(`✗ COVERAGE LOST — required target ${rel} is missing under ${repoRoot}.`);
    console.error('  It is deliberately not existsSync-gated: a target that can vanish silently shrinks');
    console.error('  this scan while it still prints "ok". If the file moved, fix the path in the same change.');
    process.exit(1);
  }
  TARGETS.push(rel);
}
// ⚠️ `wsl-setup.sh` IS STILL existsSync-GATED, AND THAT IS A STATED GAP, not a
// decision. It predates the 2026-08-17 pass, and deleting it shrinks this scan
// exactly the way hiding the gradle module did — its two java literals leave the
// run and nothing says so. Its REQUIRED_YIELD entry cannot cover that: an entry
// only fires once the file is already a target, so it detects a REWRITE of those
// literals, never their disappearance.
for (const f of ['tooling/wsl-setup.sh']) {
  if (existsSync(join(repoRoot, f))) TARGETS.push(f);
}
// Every app's Android module, found by SHAPE rather than by name — `apps/subly`
// is app #1 of a factory, so hardcoding it would leave app #2 unchecked on the
// day it is stamped. Discovery is what makes the REQUIRED_YIELD entry below a
// standing rule rather than a fact about one directory.
// 🔴 DISCOVERY MUST YIELD AT LEAST ONE — a loop that finds nothing is the silent
// shrink above wearing a different hat. Rename `android/`, or move the module,
// and the "Java (Gradle compileOptions)" and "Java (Kotlin jvmTarget)" rules
// scan NOTHING: the class-file version every Android build actually EMITS goes
// unchecked while `java-version:` in the workflows still agrees with
// versions.json, and MIN_OCCURRENCES is a GLOBAL floor the workflows clear on
// their own. That is the precise shape of the 85/14 pass measured above.
const appsDir = join(repoRoot, 'apps');
let androidModules = 0;
if (existsSync(appsDir)) {
  for (const app of listDir(appsDir)) {
    const rel = join('apps', app, 'android', 'app', 'build.gradle.kts');
    if (existsSync(join(repoRoot, rel))) {
      TARGETS.push(rel);
      androidModules++;
    }
  }
}
if (androidModules === 0) {
  console.error('✗ COVERAGE LOST — not one apps/*/android/app/build.gradle.kts was found.');
  console.error(`  Looked under ${appsDir}. The Gradle and Kotlin java rules now scan NOTHING, so what the`);
  console.error('  Android build EMITS is unchecked while the workflow `java-version:` input still agrees');
  console.error('  with versions.json. If the module moved, update this discovery in the same change.');
  process.exit(1);
}
// 🔴 THE BRICK'S STAMPED SERVICE, added 2026-07-31 after it took `main` red.
// Every real service here has a COMMITTED package-lock.json and is therefore
// immune to a bad upstream release. A STAMPED service has none by construction —
// it is generated in CI and `npm install`s fresh every run — so its `^4.0.0`
// floated onto wrangler 4.117.0, which depends on `miniflare@5.20260730.0-alpha`,
// and the install died with `notarget`. The repo pinned wrangler everywhere the
// guard looked and nowhere the factory's own product looked.
// Pinning it EXACTLY (no caret) is the point: a stamped app must resolve the same
// way tomorrow, and this rule is what stops the caret coming back.
// 🔴 The path is REQUIRED, never existsSync-gated — triage 2026-07-31
// (mutation-proven): the first version pushed this target only `if (existsSync)`,
// so renaming one brick directory segment silently deleted the rule's ONLY
// target while a live `^9.9.9` drift sat on disk — and MIN_OCCURRENCES is a
// GLOBAL floor the workflows' 41 other matches satisfy alone, so the guard
// printed "ok". A scan whose target vanished must say so, not shrink.
const BRICK_PKG = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/package.json';
if (!existsSync(join(repoRoot, BRICK_PKG))) {
  console.error(`✗ COVERAGE LOST — the brick's stamped-service package.json is gone from ${BRICK_PKG}.`);
  console.error('  The "Wrangler (brick dep)" rule now scans NOTHING, and the global MIN_OCCURRENCES floor');
  console.error('  is satisfied by the workflows alone — the caret this rule exists to block would come back');
  console.error('  unseen. If the brick moved, update this path in the same change.');
  process.exit(1);
}
TARGETS.push(BRICK_PKG);

/** A scan that quietly matches nothing reports "clean" forever. */
const MIN_OCCURRENCES = 10;

/** COMMENT SYNTAX IS PER LANGUAGE, and the target set now spans three of them.
 *  Stripping comments is not cosmetic here — it is what makes this guard compare
 *  DECLARATIONS instead of prose, the property guards.test.mjs pins as "a
 *  commented-out version cannot mask a drift".
 *
 *  `#` was right while every target was YAML or shell. The Android module is
 *  Kotlin, and the very first run against it reported
 *  `build.gradle.kts:132 Flutter is "3.44.8\`"` — a live drift finding produced
 *  entirely by a sentence explaining a PAST pin inside a `//` comment. A guard
 *  that reddens on documentation teaches people to stop reading it.
 *
 *  `//` is stripped ONLY for Kotlin/Gradle: doing it everywhere would cut
 *  `https://…` in half in the workflows, truncating real lines to chase a
 *  comment marker that language does not use.
 *
 *  ⚠️ KNOWN AND DELIBERATE: Kotlin block comments are not stripped. Handling
 *  them needs multi-line state this line-at-a-time scan does not have, and the
 *  failure mode is a FALSE POSITIVE — a red build with a named file — never a
 *  missed drift. The REQUIRED_YIELD floor below is what covers the opposite
 *  direction, where a strip removes a declaration the rules needed. */
const stripComments = (rel, line) =>
  /\.gradle(\.kts)?$|\.kts?$/.test(rel) ? line.replace(/\/\/.*$/, '') : line.replace(/#.*$/, '');

const problems = [];
let found = 0;
/** rel -> (versions.json key -> how many literals this file yielded). Recorded
 *  per FILE because the global `found` total below cannot see one file going
 *  quiet behind eighty other matches — see REQUIRED_YIELD. */
const yields = new Map();

for (const rel of TARGETS) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  const perKey = new Map();
  yields.set(rel, perKey);
  text.split('\n').forEach((line, i) => {
    const code = stripComments(rel, line);
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(code)) !== null) {
        found++;
        perKey.set(rule.key, (perKey.get(rule.key) ?? 0) + 1);
        const actual = (m[1] ?? '').trim();
        const expected = String(decl[rule.key] ?? '');
        if (actual === '') {
          problems.push(
            `${rel}:${i + 1} ${rule.label} is UNPINNED — it takes whatever is newest on every run` +
              ` (declare ${expected})`,
          );
        } else if (actual !== expected) {
          problems.push(`${rel}:${i + 1} ${rule.label} is "${actual}" but versions.json declares "${expected}"`);
        }
      }
    }
  });
}

// ── REQUIRED COVERAGE: a rule that matches nothing is not "clean" ────────────
// MIN_OCCURRENCES is a GLOBAL total, so a single rule silently matching zero
// stays invisible behind the other rules' matches. That matters most here:
// deleting the `wranglerVersion:` line does not produce an unpinned literal for
// the loop above to catch — it produces NO literal, and the deploy quietly falls
// back to the version compiled into cloudflare/wrangler-action's own bundle.
// That is exactly how production ended up on 3.90.0 while the repo used 4.114.0.
for (const rel of TARGETS) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  const code = text.replace(/^\s*#.*$/gm, '');
  if (!/uses:\s*cloudflare\/wrangler-action/.test(code)) continue;
  if (!/wranglerVersion:/.test(code)) {
    problems.push(
      `${rel} uses cloudflare/wrangler-action WITHOUT a wranglerVersion: — the action will install ` +
        `whatever version is hardcoded in its own bundle, not the ${decl.wrangler} this repo declares. ` +
        'An unpinned deploy tool holds the account API token and writes to production.',
    );
  }
}

// ── REQUIRED PER-TARGET YIELD: the global floor cannot see one file go quiet ──
// The five java literals and the melos dev_dependency contribute six matches out
// of the eighty-eight this repo yields today, so ALL SIX could stop matching and
// MIN_OCCURRENCES below would still be comfortably clear — the same "global floor
// hides a dead rule" shape already recorded on the brick target above, one layer in.
//
// What this catches is a REWRITE the regex no longer recognises rather than a
// drifted value: `sourceCompatibility(JavaVersion.VERSION_17)` in Gradle's call
// syntax, a `$JDK_MAJOR` variable in the shell script, or melos moving out of
// `dev_dependencies`. Each leaves the file still declaring a version and the
// rule silently reporting none, which reads exactly like agreement.
//
// Entries are keyed on the target's SHAPE, so app #2 inherits the rule the day
// it is stamped. Only targets actually COLLECTED above are checked, which makes
// this a REWRITE detector and not an existence detector: it fires when a file is
// still declaring a version that the rule stopped recognising.
//
// 🔴 THE EXISTENCE QUESTION IS ANSWERED ABOVE, AND FOR THREE OF THE FOUR SHAPES
// ONLY. `pubspec.yaml`, `README.md`, the brick package.json and "at least one
// apps/*/android/app/build.gradle.kts" each refuse outright when missing;
// `tooling/wsl-setup.sh` does not, so deleting it removes its two java literals
// from the scan and no entry here fires. This comment previously claimed the
// existence question was answered for EACH target — it was not, and the gradle
// module proved it by passing at 85 references across 14 files with the file
// hidden. A guard's comment overstating the guard is worse than the hole,
// because the next reader stops checking.
const REQUIRED_YIELD = [
  {
    where: /(^|[\\/])pubspec\.yaml$/,
    key: 'melos',
    min: 1,
    what: 'the `melos:` dev_dependency — the runner `melos run gate` actually resolves',
  },
  {
    where: /(^|[\\/])README\.md$/,
    key: 'melos',
    min: 1,
    what: 'the `dart pub global activate melos <version>` line in the copy-paste build block',
  },
  {
    where: /(^|[\\/])wsl-setup\.sh$/,
    key: 'java',
    min: 2,
    what: 'the JDK path and the apt `openjdk-<n>-jdk` package a local Android build installs',
  },
  {
    where: /android[\\/]app[\\/]build\.gradle\.kts$/,
    key: 'java',
    min: 3,
    what: 'sourceCompatibility, targetCompatibility and the Kotlin jvmTarget',
  },
];
/** 🔴 COVERAGE LOSS IS COLLECTED, NOT THROWN — it is reported ALONGSIDE drift,
 *  never instead of it. The first version called process.exit(1) the instant a
 *  REQUIRED_YIELD entry came up short, which discarded every `problems` entry
 *  the scan had already found. Mutation-proven on the real tree 2026-08-17:
 *  quoting the melos pin (`melos: "8.2.2"`, which the rule's leading
 *  `[\^~<>=0-9]` no longer matches) AND drifting wsl-setup.sh's `openjdk-17-jdk`
 *  to `openjdk-21-jdk` printed the coverage loss ALONE — the live java drift was
 *  found, held in `problems`, and never shown. One real finding suppressing
 *  another real finding is this file's own "a check that silently stopped
 *  checking" failure, one level up. */
const coverageLost = [];
for (const rel of TARGETS) {
  for (const req of REQUIRED_YIELD) {
    if (!req.where.test(rel)) continue;
    const n = yields.get(rel)?.get(req.key) ?? 0;
    if (n < req.min) {
      coverageLost.push([
        `✗ COVERAGE LOST — ${rel} yielded ${n} \`${req.key}\` reference(s), expected at least ${req.min}.`,
        `  Expected there: ${req.what}.`,
        '  The rule stopped matching this file; the file did not stop declaring a version.',
      ]);
    }
  }
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
if (found < MIN_OCCURRENCES) {
  coverageLost.push([
    `✗ COVERAGE LOST — matched ${found} version reference(s), expected at least ${MIN_OCCURRENCES}.`,
    '  The scan is broken, not the tree.',
  ]);
}

// ── ONE report, then one exit ────────────────────────────────────────────────
for (const block of coverageLost) for (const line of block) console.error(line);
if (problems.length) {
  console.error(`✗ ${problems.length} version drift problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('  Fix the call site, or change tooling/versions.json if the new value is intended.');
}
if (coverageLost.length || problems.length) process.exit(1);

console.log(`ok  version consistency — ${found} reference(s) across ${TARGETS.length} file(s), all match versions.json`);
