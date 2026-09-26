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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

// ⚠️ THE TABLE AND THE TARGET LIST ARE EXPORTED, AND THE RUN IS GATED ON `isMain`.
// tooling/scripts/propagate-versions.mjs WRITES the values this file REFUSES to
// let drift, and it must write them at exactly the sites this scan reads — a
// second copy of the table would be a rival that agrees until the day it does
// not, which is the failure mode this whole file exists to remove. So the rules
// and the discovery are exported and the executable half moved behind the
// `isMain` gate this repo already uses in a dozen guards. Nothing else changed:
// same rules, same targets, same messages, same exit codes, same order.
/** Each rule finds every occurrence of a versioned thing and reports the value
 *  it names, so the guard compares PARSED values rather than grepping for the
 *  expected string. Grepping for the right answer can only ever find sites that
 *  are already correct — it can never see the one that drifted. */
export const RULES = [
  { key: 'flutter', label: 'Flutter', re: /flutter-version:\s*'?([0-9][^\s'"#]*)'?/g },
  { key: 'flutter', label: 'Flutter', re: /FLUTTER_VERSION[:=]\s*'?"?([0-9][^\s'"#]*)'?"?/g },
  { key: 'node', label: 'Node', re: /node-version:\s*'?([0-9][^\s'"#]*)'?/g },
  { key: 'java', label: 'Java', re: /java-version:\s*'?([0-9][^\s'"#]*)'?/g },
  // 🔴 THE JAVA PIN IS WRITTEN IN EIGHT PLACES AND THE RULE ABOVE SAW THREE.
  // Mutation-proven on the REAL tree 2026-08-17: setting `java` to "21" in
  // versions.json named build-platforms.yml:86 and submit-play.yml:68,160 —
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
  // 🔴 THE SECOND COPY OF THE gitleaks PIN, AND IT IS IN EXECUTABLE CODE.
  // `tooling/ci/scan-secrets.mjs` declares `const VALIDATED_AGAINST = '8.30.1'`
  // — the release its `scanned ~N bytes` parser was measured against — and that
  // file states the consequence of the two drifting apart in its own words:
  // when gitleaks rewords the line, "the volume floor below stops applying, and
  // every scan afterwards passes with the coverage claim quietly missing — the
  // floor does not fail, it evaporates."
  //
  // Until 2026-09-06 the pin lived in ci.yml's `env:` block, no update
  // mechanism reached it, and the two copies could therefore only move by the
  // same hand at the same time. That changed in the same commit as this rule:
  // `gitleaks` now has a renovate.json customManager, so a BOT can advance
  // tooling/versions.json while the parser's validated version stays behind. A
  // second hand-kept copy with a machine moving the first is exactly what F-2
  // ("one declaration, and nothing may disagree") and C-GUARDED-OR-DELETED
  // exist to refuse.
  //
  // ⚠️ THIS IS NOT AN INSTRUCTION TO POINT `VALIDATED_AGAINST` AT versions.json.
  // Reading the pin at run time would make scan-secrets.mjs's own mismatch check
  // — installed gitleaks vs the version this parser was validated against —
  // compare a value with itself, which is an assertion that cannot fail. The
  // constant must stay a LITERAL and must move deliberately, together with the
  // captured canary lines beside it, exactly as scan-secrets.mjs:518 instructs.
  // What this rule adds is that forgetting to move it is now red instead of
  // silent.
  { key: 'gitleaks', label: 'gitleaks (scan-secrets VALIDATED_AGAINST)', re: /VALIDATED_AGAINST\s*=\s*'([0-9][^']*)'/g },
  { key: 'runner_ubuntu', label: 'Ubuntu runner', re: /runs-on:\s*(ubuntu-[^\s'"#]+)/g },
  { key: 'runner_windows', label: 'Windows runner', re: /runs-on:\s*(windows-[^\s'"#]+)/g },
  { key: 'runner_macos', label: 'macOS runner', re: /runs-on:\s*(macos-[^\s'"#]+)/g },
  // 🔴 THE TWO PUBSPEC FLOORS, which no rule read until 2026-09-25
  // (O-PUBSPEC-FLOORS-UNTIED-TO-THE-PIN). Measured that day: eleven workspace members
  // and the brick's hooks said `sdk: ">=3.5.0 <4.0.0"` beside a root at `^3.9.0`, and
  // every Flutter pubspec said `flutter: ">=3.24.0"` while every lane built on the
  // `flutter` pin. `files` holds both rules to pubspecs: an `sdk:` input in a workflow
  // (setup-dart's, say) selects a toolchain rather than a language, and
  // propagate-versions.mjs must never write a caret into one.
  // The sdk rule captures the WHOLE constraint, for the reason on the brick rule
  // above: `">=3.5.0 <4.0.0"` must come back unequal to `^3.9.0` whatever numbers it
  // holds, so a range form returning is a finding (the shape limb), never a pass.
  // `literal` is how the site spells the declared value — the key holds `3.9.0`, the
  // pubspec holds `^3.9.0` — and the comparison below and the propagator's write both
  // go through it. `sdk: flutter`, a dependency source, never matches: the value must
  // open with `^`, a digit or a quote.
  { key: 'dart_language', label: 'Dart language floor (pubspec environment sdk)', files: /(^|[\\/])pubspec\.yaml$/, literal: (v) => `^${v}`, re: /^\s+sdk:\s*(\^[^\s'"#]*|[0-9][^\s'"#]*|"[^"\n]*"|'[^'\n]*')\s*$/g },
  // The Flutter floor IS the `flutter` pin, so no member claims to build on a Flutter
  // older than the one every lane installs. The value alone is captured; the quoted
  // `>=` around it is the one spelling the pubspecs here use, and a pubspec that
  // depends on Flutter without it is caught by REQUIRED_YIELD below.
  { key: 'flutter', label: 'Flutter floor (pubspec environment)', files: /(^|[\\/])pubspec\.yaml$/, re: /^\s+flutter:\s*["']>=([0-9][^\s'"#]*)["']\s*$/g },
];

/** Files that may name a build version.
 *
 *  🔴 EVERY REFUSAL BELOW IS A COVERAGE-LOST EXIT, AND THAT IS THE CONTRACT THIS
 *  FUNCTION CARRIES TO ITS CALLERS: it either returns a target list that has been
 *  checked to be complete, or it exits 1 having said which target vanished. A
 *  caller that wanted to continue past a missing target would be scanning LESS
 *  and reporting the same, which is the 85-references-across-14-files pass
 *  measured on 2026-08-17 and recorded throughout the body below. */
export function collectTargets(repoRoot) {
  const TARGETS = [];
  const wfDir = join(repoRoot, '.github', 'workflows');
  if (existsSync(wfDir)) {
    for (const f of listDir(wfDir).filter((x) => x.endsWith('.yml') || x.endsWith('.yaml'))) {
      TARGETS.push(join('.github', 'workflows', f));
    }
  }
  // ⏱ 2026-09-15 — THE WORKFLOWS WERE THE ONE existsSync-GATED TARGET LEFT. With
  // .github/workflows moved aside this guard printed `ok  version consistency — 10
  // reference(s) across 6 file(s)` and exited 0: every CI pin left the run and the
  // rest of the tree cleared the floors (O-LOCAL-SCRIPTS-PARSE-MOVED-WORKFLOWS).
  // Exit 1, not 2, because that is this function's documented contract with
  // tooling/scripts/propagate-versions.mjs, the other caller.
  if (TARGETS.length === 0) {
    console.error(`✗ COVERAGE LOST — read ZERO workflow files under ${wfDir}.`);
    console.error('  The CI runner, SDK and tool pins live in those files; without them this scan compares the');
    console.error('  remaining targets with each other and still prints "ok".');
    coverageLost();
  }
  // ⏱ 2026-09-24 — P-A1: a step moved out of a workflow into a local composite
  // action (`uses: ./.github/actions/<x>`) takes its pins with it, so each
  // `.github/actions/<x>/action.yml` is read by the same rules as a workflow.
  // Added AFTER the zero-workflows check on purpose: an action file must never be
  // the reason that check is satisfied.
  const actionsDir = join(repoRoot, '.github', 'actions');
  if (existsSync(actionsDir)) {
    for (const d of listDir(actionsDir)) {
      for (const f of ['action.yml', 'action.yaml']) {
        if (existsSync(join(actionsDir, d, f))) TARGETS.push(join('.github', 'actions', d, f));
      }
    }
  }
  // 🔴 REQUIRED, NEVER existsSync-GATED — and this is the BRICK_PKG lesson below
  // being paid for a second time. Both of these landed `if (existsSync)` on
  // 2026-08-17 and the hole was mutation-proven the same day: HIDING
  // apps/subscriptiontracker/android/app/build.gradle.kts made this guard print
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
      coverageLost();
    }
    TARGETS.push(rel);
  }
  // 🔴 EVERY PUBSPEC THAT CARRIES A LANGUAGE OR FLUTTER FLOOR, REQUIRED LIKE THE TWO
  // ABOVE (O-PUBSPEC-FLOORS-UNTIED-TO-THE-PIN, 2026-09-25). The members come from the
  // root's own `workspace:` list, the list pub resolves, so a package that joins the
  // workspace is a target in the same change; the brick's app template and its hooks
  // are named because the brick is not a workspace member. A listed member whose
  // pubspec is missing refuses, and so does a list that yields nobody: either shrinks
  // the floor rules' reach while the global count stays clear.
  const members = workspaceMembers(readFileSync(join(repoRoot, 'pubspec.yaml'), 'utf8'));
  if (members.length === 0) {
    console.error('✗ COVERAGE LOST — the root pubspec.yaml lists no `workspace:` members.');
    console.error('  The Dart language and Flutter floor rules read every member pubspec; with the list');
    console.error('  unreadable they would read the root alone and still print "ok".');
    coverageLost();
  }
  for (const rel of [
    ...members.map((m) => `${m}/pubspec.yaml`),
    'tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml',
    'tooling/bricks/app/hooks/pubspec.yaml',
  ]) {
    if (!existsSync(join(repoRoot, rel))) {
      console.error(`✗ COVERAGE LOST — required pubspec ${rel} is missing under ${repoRoot}.`);
      console.error('  It carries an `environment:` floor the Dart language and Flutter floor rules compare');
      console.error('  with tooling/versions.json. If it moved, fix the root `workspace:` list or this path.');
      coverageLost();
    }
    TARGETS.push(rel);
  }
  // 🔴 THE SECRET SCANNER'S PARSER, REQUIRED AND NEVER existsSync-GATED. It holds
  // the only copy of the `gitleaks` pin outside tooling/versions.json (see the
  // "gitleaks (scan-secrets VALIDATED_AGAINST)" rule above), and it is a `.mjs`
  // rather than a workflow or a manifest — the first non-declarative target this
  // scan has ever carried. Gating it would reproduce the 2026-08-17 gradle hole
  // one file over: delete or rename it and the rule's ONLY target leaves the run,
  // MIN_OCCURRENCES is cleared ninety times over by the workflows alone, and the
  // guard prints `ok` having stopped comparing the two copies it was added for.
  // If scan-secrets.mjs is ever genuinely retired, delete the rule, this target
  // and the REQUIRED_YIELD entry below in the same commit — C-GUARDED-OR-DELETED.
  for (const rel of ['tooling/ci/scan-secrets.mjs']) {
    if (!existsSync(join(repoRoot, rel))) {
      console.error(`✗ COVERAGE LOST — required target ${rel} is missing under ${repoRoot}.`);
      console.error('  It carries `const VALIDATED_AGAINST = <gitleaks version>`, the second live copy of the');
      console.error('  `gitleaks` pin. With the file gone this guard no longer compares the two copies at all,');
      console.error('  while Renovate keeps advancing the one in tooling/versions.json. If the scanner moved,');
      console.error('  fix this path, the rule and the REQUIRED_YIELD entry in the same change.');
      coverageLost();
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
  // Every app's Android module, found by SHAPE rather than by name — `apps/subscriptiontracker`
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
    coverageLost();
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
    coverageLost();
  }
  TARGETS.push(BRICK_PKG);
  // ⏱ 2026-09-24 (EXT-3) — THE WRANGLER ISLAND, REQUIRED FOR THE SAME REASON AS
  // THE BRICK. deploy-web.yml creates each Pages project with the binary
  // `npm ci --ignore-scripts --prefix tooling/wrangler` installs, so the island's
  // exact `"wrangler"` devDependency is a live copy of the pin that publishes
  // production. The "Wrangler (brick dep)" rule reads it; the target is not
  // existsSync-gated, because a vanished island would shrink this scan in silence.
  const WRANGLER_ISLAND_PKG = 'tooling/wrangler/package.json';
  if (!existsSync(join(repoRoot, WRANGLER_ISLAND_PKG))) {
    console.error(`✗ COVERAGE LOST — the wrangler island's package.json is gone from ${WRANGLER_ISLAND_PKG}.`);
    console.error('  deploy-web.yml runs that island\'s wrangler; with the file gone its pin leaves this scan while');
    console.error('  the workflows alone still clear the global floor. If the island moved, fix this path in the same change.');
    coverageLost();
  }
  TARGETS.push(WRANGLER_ISLAND_PKG);

  return TARGETS;
}

/** The root pubspec's `workspace:` entries, in order. `#` comments are stripped
 *  first; the list ends at the first line that is not an indented `- <path>` item. */
function workspaceMembers(text) {
  const out = [];
  let inList = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!inList) {
      if (line === 'workspace:') inList = true;
      continue;
    }
    if (line === '') continue;
    const m = /^\s+-\s+(\S+)$/.exec(line);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

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
 *  direction, where a strip removes a declaration the rules needed.
 *
 *  EXPORTED for tooling/scripts/propagate-versions.mjs, which must strip exactly
 *  what this scan strips: a propagator that did not would rewrite the version
 *  inside a `#` comment — and pubspec.yaml's melos block quotes three of the six
 *  call sites in prose, so that is not a hypothetical line to protect. */
export const stripComments = (rel, line) =>
  /\.gradle(\.kts)?$|\.kts?$/.test(rel) ? line.replace(/\/\/.*$/, '') : line.replace(/#.*$/, '');
/** 📏 THIS TABLE IS THE MELOS INVENTORY, and the root pubspec's comment points here
 *  rather than listing the places itself (O-PUBSPEC-FLOORS-UNTIED-TO-THE-PIN). The
 *  places the melos pin is written are: the root pubspec's dev_dependency, ci.yml's
 *  activate and README.md's activate, each an entry below; tooling/versions.json,
 *  which every one is compared to; and pubspec.lock, which the resolver writes and
 *  `flutter pub get --enforce-lockfile` holds to the dev_dependency. `when` narrows an
 *  entry to the targets whose text makes it apply. */
const REQUIRED_YIELD = [
  {
    // The ROOT only: member pubspecs are targets too, and none of them declares melos.
    where: /^pubspec\.yaml$/,
    key: 'melos',
    min: 1,
    what: 'the `melos:` dev_dependency — the runner `melos run gate` actually resolves',
  },
  {
    where: /(^|[\\/])\.github[\\/]workflows[\\/]ci\.yml$/,
    key: 'melos',
    min: 1,
    what: 'the `dart pub global activate melos <version>` CI runs before `melos run gate`',
  },
  {
    where: /(^|[\\/])README\.md$/,
    key: 'melos',
    min: 1,
    what: 'the `dart pub global activate melos <version>` line in the copy-paste build block',
  },
  {
    where: /(^|[\\/])pubspec\.yaml$/,
    key: 'dart_language',
    min: 1,
    what: 'the `environment:` `sdk: ^<dart_language>` constraint every pubspec here carries',
  },
  {
    where: /(^|[\\/])pubspec\.yaml$/,
    when: (text) => /^\s+sdk:\s*flutter\s*$/m.test(text),
    key: 'flutter',
    min: 1,
    what: 'the `environment:` `flutter: ">=<flutter>"` floor a pubspec with an `sdk: flutter` dependency carries',
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
  {
    where: /(^|[\\/])scan-secrets\.mjs$/,
    key: 'gitleaks',
    min: 1,
    what: "the `const VALIDATED_AGAINST = '<version>'` the volume parser was measured against",
  },
  {
    where: /(^|[\\/])tooling[\\/]wrangler[\\/]package\.json$/,
    key: 'wrangler',
    min: 1,
    what: 'the exact `"wrangler"` devDependency deploy-web.yml installs from the island lockfile',
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

function main() {
  const repoRoot = process.argv[2] ?? process.cwd();
  const declPath = join(repoRoot, 'tooling', 'versions.json');

  if (!existsSync(declPath)) {
    console.error(`✗ no tooling/versions.json under ${repoRoot} — nothing to check against`);
    process.exit(1);
  }
  const decl = JSON.parse(readFileSync(declPath, 'utf8'));
  const TARGETS = collectTargets(repoRoot);

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
        if (rule.files && !rule.files.test(rel)) continue;
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(code)) !== null) {
          found++;
          perKey.set(rule.key, (perKey.get(rule.key) ?? 0) + 1);
          const actual = (m[1] ?? '').trim();
          const declared = decl[rule.key];
          const expected = declared === undefined ? '' : rule.literal ? rule.literal(String(declared)) : String(declared);
          if (actual === '') {
            problems.push(
              `${rel}:${i + 1} ${rule.label} is UNPINNED — it takes whatever is newest on every run` +
                ` (declare ${expected})`,
            );
          } else if (actual !== expected) {
            problems.push(
              rule.literal && declared !== undefined
                ? `${rel}:${i + 1} ${rule.label} is ${actual} but versions.json \`${rule.key}\` "${declared}" is written here as ${expected}`
                : `${rel}:${i + 1} ${rule.label} is "${actual}" but versions.json declares "${expected}"`,
            );
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

  // ── THE ROOT PUBSPEC'S COMMENTS, which RULES never see ───────────────────────
  // stripComments hides every `#` from RULES on purpose: it is what keeps the
  // propagator out of prose. The cost was measured 2026-09-25: the melos block above
  // the root's dev_dependency still quoted the 2026-08-17 pin eight times while the
  // line under it had moved on (O-PUBSPEC-FLOORS-UNTIED-TO-THE-PIN). So this limb
  // reads that one file's comments and names any `melos <version>` in them that
  // differs from versions.json. It only reports — the propagator writes no comment —
  // and the fix is the sentence without the number.
  const COMMENT_MELOS = /\bmelos:?\s+[\^~]?v?([0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*)/gi;
  readFileSync(join(repoRoot, 'pubspec.yaml'), 'utf8').split('\n').forEach((line, i) => {
    const hash = line.indexOf('#');
    if (hash === -1) return;
    for (const m of line.slice(hash).matchAll(COMMENT_MELOS)) {
      if (m[1] !== String(decl.melos)) {
        problems.push(
          `pubspec.yaml:${i + 1} a comment quotes melos "${m[1]}" but versions.json declares "${decl.melos}"` +
            ' — no script rewrites a comment, so write that sentence without the version',
        );
      }
    }
  });

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
  // apps/*/android/app/build.gradle.kts" each refuse outright when missing, as do
  // (since 2026-09-25) each member pubspec the root lists and the brick's two pubspecs;
  // `tooling/wsl-setup.sh` does not, so deleting it removes its two java literals
  // from the scan and no entry here fires. This comment previously claimed the
  // existence question was answered for EACH target — it was not, and the gradle
  // module proved it by passing at 85 references across 14 files with the file
  // hidden. A guard's comment overstating the guard is worse than the hole,
  // because the next reader stops checking.
  const lostBlocks = [];
  for (const rel of TARGETS) {
    for (const req of REQUIRED_YIELD) {
      if (!req.where.test(rel)) continue;
      if (req.when && !req.when(readFileSync(join(repoRoot, rel), 'utf8'))) continue;
      const n = yields.get(rel)?.get(req.key) ?? 0;
      if (n < req.min) {
        lostBlocks.push([
          `✗ COVERAGE LOST — ${rel} yielded ${n} \`${req.key}\` reference(s), expected at least ${req.min}.`,
          `  Expected there: ${req.what}.`,
          '  The rule stopped matching this file; the file did not stop declaring a version.',
        ]);
      }
    }
  }

  // ⏱ 2026-09-24 — P-A1: THE PINS OF A `uses:` THIS SCAN CANNOT OPEN ARE UNREAD.
  // A local composite or reusable workflow is read above only if its file is in
  // the tree, and a REMOTE reusable workflow's pins never are, so a reference to
  // either is a file this scan did not look at — COVERAGE LOST, as the four
  // workflow-scan readers refuse the same two shapes.
  for (const rel of TARGETS) {
    if (!/^\.github[/\\]/.test(rel)) continue;
    readFileSync(join(repoRoot, rel), 'utf8').split('\n').forEach((line, i) => {
      const m = /^\s*(?:-\s+)?uses:\s*['"]?([^\s'"#]+)/.exec(stripComments(rel, line));
      if (!m) return;
      const ref = m[1];
      if (ref.startsWith('./')) {
        const p = join(repoRoot, ref);
        const present = /\.ya?ml$/.test(ref)
          ? existsSync(p)
          : existsSync(join(p, 'action.yml')) || existsSync(join(p, 'action.yaml'));
        if (!present) {
          lostBlocks.push([
            `✗ COVERAGE LOST — ${rel}:${i + 1} uses ${ref}, which names no file in this tree (missing).`,
            '  Any pin it carries is a pin this scan never read.',
          ]);
        }
      } else if (/^[^./][^@]*\/\.github\/workflows\/[^@]+@/.test(ref)) {
        lostBlocks.push([
          `✗ COVERAGE LOST — ${rel}:${i + 1} calls a REMOTE reusable workflow ${ref} (remote).`,
          '  Its jobs and their pins are not in this tree, so this scan cannot read them.',
        ]);
      }
    });
  }

  // ── coverage self-check, BEFORE reporting clean ──────────────────────────────
  if (found < MIN_OCCURRENCES) {
    lostBlocks.push([
      `✗ COVERAGE LOST — matched ${found} version reference(s), expected at least ${MIN_OCCURRENCES}.`,
      '  The scan is broken, not the tree.',
    ]);
  }

  // ── ONE report, then one exit ────────────────────────────────────────────────
  for (const block of lostBlocks) for (const line of block) console.error(line);
  if (problems.length) {
    console.error(`✗ ${problems.length} version drift problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('  Fix the call site, or change tooling/versions.json if the new value is intended.');
    console.error('  To move every site above to what versions.json declares, in one step:');
    console.error('      node tooling/scripts/propagate-versions.mjs --write');
    console.error('  It writes from THIS table, so it cannot move a site this guard does not read, and it');
    console.error('  REFUSES (exit 2, writing nothing) at any site that cannot hold the declared value —');
    console.error('  the `java`/`node` floor class renovate.json describes, which stays a hand decision.');
  }
  if (problems.length) process.exit(1); else if (lostBlocks.length) coverageLost(); // a drift is a finding (1); only COVERAGE LOST is could-not-look (2)

  console.log(`ok  version consistency — ${found} reference(s) across ${TARGETS.length} file(s), all match versions.json`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-version-consistency.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}
