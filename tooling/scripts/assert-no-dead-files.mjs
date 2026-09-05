#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-dead-files.mjs — every TRACKED path is reachable, or waived by name
// with a dated reason.
//
// 🔴 WHY THIS EXISTS. Nothing in this repo has ever asked whether a tracked file
// is still reached by anything. `guard-sweep.mjs` asks it of `tooling/ci/*.mjs`
// and only of that directory (CI_DIR at guard-sweep.mjs:64,73), which is exactly
// how `tooling/ops/set-monitor-thresholds.mjs` — a script that WRITES to the live
// GlitchTip instance — came to have no workflow, no register row and no test,
// with every completeness sweep in the tree reporting clean. This guard closes
// the same hole from the other side: it walks the whole tracked manifest instead
// of one directory.
//
// ── THE DESIGN CONSTRAINT THAT OUTRANKS EVERY OTHER ──────────────────────────
// A guard that cries wolf gets disabled within a week, and then its subject is
// worse off than before, because the disabled guard still carries the belief that
// something is being checked. So this errs HARD toward "reachable":
//
//   · Eight resolvers, each a superset of what it strictly needs to prove.
//   · Whole trees are conceded to a NAMED runner that walks them (Gradle, Xcode,
//     mason, Eleventy, the Cloudflare deploy, `melos run test`), because a file a
//     runner reaches by walking a directory is reached, and no reference to it
//     will ever exist to be found.
//   · Anything left is WAIVED BY NAME with a dated reason rather than reported.
//
// The exemption table below is therefore LARGE on purpose. It is an inventory of
// what this tree looked like on the day the guard was written, and the guard's
// value is not in the rows — it is that the row count can only be reduced by an
// edit somebody has to justify, while a NEW unreached file needs no edit at all
// to be caught. It starts large and shrinks.
//
// ── WHAT COUNTS AS A REFERENCE, AND THE THREE MEASUREMENTS THAT SHAPED IT ─────
//
// (1) THE REFERENCE SOURCES ARE THE TRACKED FILES, AND `Private/` IS NOT ONE.
//     This is not a privacy decision, it is a soundness one. The 2026-08-17
//     public-tree review found `tooling/preflight_check.py` and
//     `set-monitor-thresholds.mjs` dead — and then, by SAYING SO in a file, made
//     both of them look referenced to any mention-counting scan. Three of four
//     real candidates that day were masked by the same file: the audit that
//     declared them dead. Reading only the tracked manifest removes THOSE
//     maskers, because every one of them lives under gitignored `Private/`. It
//     also makes this guard's answer identical on the owner's machine, in a
//     fresh public clone, and on a CI runner — the three places where `Private/`
//     is present, absent, and absent respectively.
//
//     🔴 IT DOES NOT REMOVE THE CLASS, AND THE FIRST DRAFT OF THIS PARAGRAPH
//     CLAIMED IT DID. Prose in a TRACKED file counts as a reference here, by
//     design — a README naming a script is a real consumer — so mention-masking
//     is merely relocated inside the public tree, not eliminated. It was
//     measured on 2026-08-17, in the file this guard was written to protect:
//     `services/subly-api/src/lib/d1.ts` resolved on ONE source, a comment in
//     `services/subly-api/src/lib/error-sink.ts` reading "same reason
//     `lib/d1.ts` is duplicated", while all SEVEN of its real importers
//     contributed nothing — five write `../lib/d1`, `src/index.ts` writes
//     `./lib/d1`, `test/renewals.test.ts` writes `../src/lib/d1`, and every one
//     of those is extensionless and so matched no tracked path (see (3)).
//     Deleting that one comment would have reported a live, imported module as
//     dead — which is this guard's worst outcome, not its intended one.
//
//     So the honest statement of the property is: this guard cannot be masked by
//     a file it never reads, and `Private/` is the tree it never reads. Inside
//     the tracked tree, a mention still counts, and `--why <path>` naming a
//     single prose source is the signal that a path is alive on prose alone.
//
// (2) A BARE BASENAME CANNOT RESOLVE ACROSS DEPLOY ROOTS. `sites/nikatru/
//     icon-16.png` has no reference of its own; it looks referenced only because
//     `sites/rajasekarselvam/index.html:27` links the OTHER site's copy at the
//     root-relative URL `/icon-16.png`. So a reference must carry a directory
//     segment (`nikatru/icon-16.png`), and a bare basename resolves ONLY when
//     exactly one tracked file bears it — see `unique-name` below. Both copies
//     of `icon-16.png` are reached here by `runner-walk` instead, which is the
//     honest reason: a deploy publishes its whole root.
//
// (3) A MODULE SPECIFIER CARRIES NO EXTENSION, SO IT MATCHED NOTHING. Measured
//     2026-08-17 across the 36 tracked `.ts` files under `services/*/src`: of
//     103 static `from '…'` specifiers, exactly 2 carried an extension (both
//     `.json`), and 80 of the 82 RELATIVE ones were extensionless. `path-
//     reference` compares a token against suffixes of real tracked paths, and
//     `lib/d1` is a suffix of nothing, so the entire TypeScript import graph
//     contributed ZERO references and every one of those files passed on prose,
//     a workflow line, or a bare basename instead. That is a false negative in
//     the exact class this guard exists to catch — a Worker route could be
//     deleted from `index.ts` and stay "reached" by a README. The `module-
//     import` resolver below closes it by re-offering an extensionless token as
//     `+.ts/.tsx/.js/.mjs/.cjs` and as `/index.<ext>`, and the canary in F3
//     pins it to a NAMED importer so it cannot silently stop resolving.
//
//     ⚠️ IT INHERITS (2)'s AMBIGUITY RATHER THAN SOLVING IT. `services/platform`
//     and `services/subly-api` are twinned Workers each carrying their own
//     `lib/d1.ts`, so the suffix `lib/d1.ts` belongs to TWO tracked paths and a
//     specifier in either twin reaches both. Measured 2026-08-17 for subly-api's
//     copy: 13 sources — 7 in `services/subly-api/`, which are exactly its real
//     importers, 5 in `services/platform/`, which import the OTHER twin, and 1
//     in the mason brick template. So the COUNT overstates by ~2x here.
//     `path-reference` already behaved exactly this way on the same suffix; this
//     resolver is no worse and no better, and closing it is a separate change to
//     a shared rule, not something to bolt onto this one. It is why the canary
//     pins a `from` in the SAME service instead of trusting the count.
//
// ── WHERE IT IS WIRED, AND THE ONE PLACE IT MUST NOT BE ──────────────────────
// 🔴 IT IS A MERGE GATE AS OF 2026-08-17. `.github/workflows/ci.yml`, the
// `No dead tracked files` step in the `platform:` job — which is in `ci-gate`'s
// `needs`, so a finding here is a red required check. Wiring it was the whole
// point of the guard; until then it was a tool somebody had to remember.
//
// ⚠️ IT STAYED IN `tooling/scripts/` RATHER THAN MOVING TO `tooling/ci/`, and
// the reason is mechanical rather than aesthetic. `guard-sweep.mjs` sweeps ONLY
// its `CI_DIR`, which is `tooling/ci` — so a file landing there must be invoked
// by a workflow or it is swept as UNREACHED and the sweep exits 1. Staying here
// sidesteps that entirely, and `tooling/scripts/check-selection-record.mjs` —
// wired into this same `platform:` job, just above this guard's step — is the
// standing precedent for a `tooling/scripts` guard that CI runs. The move was
// measured end-to-end anyway and is green in four edits if it is ever wanted;
// nothing in this file needs to change for it, because `ROOT =
// resolve(HERE,'..','..')` is the repo root from either directory.
//
// It still owes `assert-guard-coverage.mjs` a negative test, because that guard
// DERIVES its subject set from the workflows rather than from a hand list: every
// `tooling/**` script a workflow invokes must be named, on an EXECUTABLE line, by
// a file under `tooling/ci/test/` (its `invokedOutside` loop). That file is
// `tooling/ci/test/no-dead-files.test.mjs`, and it mutates a real-tree copy
// rather than a hand-built fixture — see its header for why a fixture would not
// have counted.
//
// 🔴 NOT `.githooks/pre-push`, AND NOT `tooling/scripts/spec-guards.mjs`. The
// slow tier of the hook is empty and this is exactly the shape that tier is for,
// which is what makes the exclusion worth stating rather than assuming. It is
// excluded because THE HOOK RUNS ON DIRTY TREES BY CONSTRUCTION while this
// guard's answer is only reproducible on a clean one (see the mixed-snapshot
// section below).
//
// MEASURED 2026-08-17, on a real-tree copy rather than argued: strip the token
// `defaults.example.json` from the working-tree bodies of the FOUR tracked files
// that write it, stage nothing, and the index still holds all 1212 paths — the
// COMMIT is clean — while this guard exits 1 with
// `apps/subly/config/defaults.example.json — no resolver reaches it`. That is a
// red gate over uncommitted work-in-progress, which is the cry-wolf failure that
// gets a hook bypassed with `--no-verify`; and a bypassed hook leaves its subject
// worse off than no hook, because the belief that something is being checked
// survives. (The scoping brief put that number at two sources. It is four:
// apps/subly/README.md, apps/subly/lib/core/app_config.dart,
// tooling/ci/assert-stamp-text-fidelity.mjs and its test.) A CI checkout is clean
// by construction, so in CI the drift is always 0 and this hazard cannot arise.
//
// ── COVERAGE FLOOR ───────────────────────────────────────────────────────────
// "Every scanner needs a test that it is still scanning what it thinks." Three
// floors, and NONE of them is a hand-ratcheted number that two branches would
// both have to edit (`assert-guard-coverage.mjs` records what those cost here —
// three collisions in one day on PR #112/#113/#114):
//
//   F1  the `git ls-files` spawn exited 0 and returned a plausible count. This is
//       a number, and it is the only one: it is a floor against an EMPTY or
//       truncated enumeration (wrong cwd, not a repo, git absent), not a ratchet
//       against tree size, so it sits far below any plausible tree.
//   F2  every resolver resolved at least one path. A resolver that silently stops
//       resolving — a renamed workflow key, a moved melos script — would
//       otherwise reclassify a swathe of the tree as dead and the guard would
//       report the reclassification as a finding.
//   F3  NAMED CANARIES, each a RELATIONSHIP rather than a count: this exact file
//       must be reached by that exact resolver. A total can stay healthy while
//       one limb dies. Two of them are NEGATIVE canaries — a file that must NOT
//       be reached a particular way — because the rules in (2) above are only
//       load-bearing if breaking them is detectable.
//
// ── 🔴 THE RUN IS ONLY AS REPRODUCIBLE AS THE WORKING TREE IS CLEAN ──────────
// The MANIFEST comes from the git INDEX (`git ls-files`); the BODIES come from
// the WORKING TREE (`readFileSync`). Those are two different snapshots, and on a
// dirty tree they disagree. TWO consequences, both measured:
//
//   · an UNSTAGED edit that adds a reference makes a path look reached;
//   · an UNSTAGED edit that removes one makes a path look dead — the case the
//     placement note above measures in full, and the reason this is not a hook.
//
// ⚠️ A THIRD BULLET STOOD HERE UNTIL 2026-08-17 AND IT WAS FALSE. It claimed "a
// NEW file that is not yet staged is not a subject at all, but IS a reference
// source, so it can keep another path alive without being checked." It is
// neither. Bodies are read only for paths in `tracked` (the `for (const p of
// tracked)` loop below), and the reference index iterates those same bodies, so
// an untracked file contributes nothing in either direction. Measured rather
// than reasoned: an untracked `UNTRACKED-probe.md` naming two WAIVED paths left
// the output byte-identical — same 1212/1208/4, and zero stale-permission notes,
// which is exactly what would have appeared had it counted as a source.
//
// The bullet mattered because it was the most alarming of the three and the only
// one nobody could reproduce; a caveat that overstates its own hazard gets the
// true ones discounted with it.
//
// A verifier hit the two real cases on 2026-08-17 and could not reproduce a
// result.
// 🔴 THE MIXED SNAPSHOT IS DELIBERATE AND IT IS NOT GOING TO BE FIXED BY READING
// THE INDEX. Two reasons, and the second is the decisive one:
//
//   · Reading `git show :path` for every tracked path is ~1200 process spawns on
//     Windows; the batch form (`git cat-file --batch`) is a second body reader
//     that could drift from this one.
//   · It has TWO callers now, and the working tree is the right subject for both.
//     In CI (the placement note ABOVE — this stopped being a hand-run-only tool on
//     2026-08-17) the checkout is clean, so index and working tree are the same
//     snapshot and the distinction is void. Run by hand, answering about the index
//     would answer about a tree the operator is not about to push, and it would
//     disagree with the exemption table's anti-rot limb, which asks `existsSync`
//     — i.e. the working tree — on purpose.
//
// So the constraint is DOCUMENTED rather than removed, and it is not documented
// only here where it can be skipped: every run counts the tracked paths that
// differ from the index and prints that count in the ok line AND at the top of
// any finding list. `0 dirty` is the reproducible case; anything else is stated
// in the output, next to the verdict it qualifies. If you are comparing two runs
// or filing a finding, `git stash -u` first and re-run.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//   0 = every tracked path is reached or waived
//   1 = a finding: an unreached unwaived path, or a waiver that outlived its file
//   2 = could not run: a floor failed, so the tree was never really scanned
//
// Usage:  node tooling/scripts/assert-no-dead-files.mjs [--list] [--why <path>]
//           --list        print every path with the resolver that reached it
//           --why <path>  print just that path's verdict and reasons
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const LIST = process.argv.includes('--list');
const WHY = (() => {
  const i = process.argv.indexOf('--why');
  return i === -1 ? null : process.argv[i + 1] ?? null;
})();

// ═════════════════════════════════════════════════════════════════════════════
// THE EXEMPTION TABLE
//
// Every row waives ONE tracked path from the reachability requirement. A row is
// a claim with an author's judgement in it, so it carries the date it was made
// and a `why` that names WHO opens the file or WHAT keeps it, not a category.
//
// `kind` is a CLOSED set, and closing it is the point. `tooling/publishable-
// inputs.json` already records the failure mode a free-text field invites: "a
// name can be PRE-APPROVED — approved today, added months later by somebody who
// reads the entry as permission."
//
//   human-entry-point  a person opens or runs it directly; there is no caller to
//                      find, and there never will be.
//   operator-tool      a script an operator runs by hand against a live system.
//                      Unreferenced is a real defect in its DECLARATION (it wants
//                      a register row), but it is not dead and must not be swept.
//   platform-scaffold  a toolchain reads it by a convention this guard's
//                      `runner-walk` table does not model.
//   frozen-record      kept deliberately as evidence of a past state. Nothing
//                      should reference it; that is what makes it a record.
//   removal-candidate  believed dead, pending a decision or another change. 🔴 A
//                      row of this kind is the ONE kind expected to be deleted
//                      rather than to persist, and deleting the FILE without
//                      deleting the ROW is caught below by design.
//
// 🔴 A waiver must not outlive the thing it waived. A row whose `path` is neither
// tracked nor on disk is a FINDING, not a warning — see the table checks below.
// ═════════════════════════════════════════════════════════════════════════════
const KINDS = new Set([
  'human-entry-point',
  'operator-tool',
  'platform-scaffold',
  'frozen-record',
  'removal-candidate',
]);

const EXEMPTIONS = [
  // 🔴 THE ROW FOR tooling/scripts/preflight.mjs IS GONE, REMOVED 2026-08-17.
  // It waived "the local pre-push gate a session runs by hand", on the reasoning
  // that "no workflow will ever invoke it and there is no caller to find". The
  // first half is still true and the second half stopped being true: this guard
  // printed the stale-permission note below on EVERY run — `path-reference` now
  // reaches it — and that note exists precisely so a row cannot quietly outlive
  // its reason.
  //
  // ⚠️ "SOMETHING MENTIONS IT" WOULD NOT HAVE BEEN ENOUGH, because the resolvers
  // here are generous by design and a single new mention in a tracked .md flips
  // `path-reference`. The row went on a BUILD-FAILING binding instead, measured
  // on the real tree rather than argued: tooling/ci/assert-guards-refuse-empty.mjs
  // carries preflight.mjs in its EXEMPT map ("a probe of it is an outward-facing
  // or unbounded act"), and that map's own limb fails when an entry names a file
  // the scan did not enumerate. `git rm -f tooling/scripts/preflight.mjs` →
  // assert-guards-refuse-empty.mjs EXIT 1, "is excused ... and this scan did not
  // enumerate it". Restored immediately. So the file is now held by a guard that
  // goes red without it, which is strictly stronger than this waiver was, and a
  // second claim over the same file would only be a second thing to keep true.
  // (The same mutation also proved the anti-rot limb below: with the file gone
  // and the row still present, this guard exited 1 — "waives tooling/scripts/
  // preflight.mjs, which is neither tracked nor on disk".)
  //
  // 🔴 THE ROW THAT WAIVED THIS FILE ITSELF IS GONE, and its own instruction is
  // why: "Delete this row the moment a workflow or a hook names it." ci.yml's
  // `No dead tracked files` step now runs `node tooling/scripts/assert-no-dead-
  // files.mjs`, so `path-reference` reaches this file from a real consumer and
  // the waiver had become a claim about nothing. Left in place it would have
  // printed the stale-permission note below on every run, forever.
  {
    path: 'tooling/ops/set-monitor-thresholds.mjs',
    kind: 'operator-tool',
    since: '2026-08-17',
    why:
      'the only read-back-verified writer for GlitchTip\'s full-replace monitor API, run by hand with ' +
      '--apply against the live instance. [ADR 043] records what that API does unattended: nine monitors ' +
      'silently detached from their projects. 🔴 WHO OPENS IT AND WHEN, which is the part a waiver owes: ' +
      'the operator, EVERY TIME A NEW UPTIME MONITOR IS CREATED — not once at provisioning. Its POLICY ' +
      '(set-monitor-thresholds.mjs:124) is `{ GET: 2 }`, a rule over a monitor TYPE rather than a list of ' +
      'ids, and GlitchTip creates every monitor at `confirmationThreshold: 1` (its default, the header\'s ' +
      'measured cause of the 122-alert flap that consumed the shared Resend quota and blocked signup ' +
      'confirmation mail for a day). So each new GET monitor arrives non-compliant and this is what makes ' +
      'it compliant. It is also idempotent and DRY-RUN BY DEFAULT (--apply writes), so a bare run is ' +
      'itself the audit: it prints any monitor that has drifted back to 1 and writes nothing. ' +
      '⚠️ THAT IS WHY "IT HAS ALREADY BEEN RUN" IS NOT AN ARGUMENT FOR DELETING IT — the tree it acts on ' +
      'is the live instance, which grows. 🔴 The real defect is that it has no row in ' +
      'tooling/ops/register.json — guard-sweep.mjs sweeps only tooling/ci, so nothing ever declared it — ' +
      'and the repair is that row, NOT a deletion. When the row lands, mechanism.readBy should name this ' +
      'script so deleting it reddens assert-ops-register.mjs, and this waiver can go — the same ' +
      'build-failing-binding test that retired the preflight.mjs row above on 2026-08-17.',
  },
  {
    path: 'tooling/release/RELEASE-RUNBOOK.md',
    kind: 'human-entry-point',
    since: '2026-08-17',
    why:
      'the owner opens it at the moment of a release; its own first line names that audience. Nothing links ' +
      'to it because a runbook is read by a person rather than called by anything, and it is in the public ' +
      'tree on purpose so a fork can release from it.',
  },
  {
    path: 'services/platform/.dev.vars.example',
    kind: 'human-entry-point',
    since: '2026-08-17',
    why:
      'a developer copies it to `.dev.vars` (gitignored) before `wrangler dev`; wrangler reads the COPY and ' +
      'never this file. Its twin services/subly-api/.dev.vars.example is reached only because that ' +
      "service's README happens to name it — an asymmetry between two READMEs, not a difference in how the " +
      'two files are used, so waiving this one is the honest treatment rather than a hint that it is dead.',
  },
  // 🔴 AND SO IS THE `removal-candidate` ROW FOR tooling/preflight_check.py —
  // together with the file. That row was the one kind expected to be deleted
  // rather than to persist, and its own last clause said how: "delete this row
  // in the same change that deletes the file." Both went on 2026-08-17.
  //
  // ⚠️ THE RATIONALE THAT TRAVELLED WITH THAT DELETION IN REVIEW — "the only
  // Python file in a Dart/JS repo" — IS FALSE, and it is recorded here because
  // acting on it would break the release lane. `git ls-files | grep '\.py$'`
  // returns TWO paths, and the other one is live: build-platforms.yml runs
  // `python3 tooling/ci/patch-flutter-macos-aot.py "$FLUTTER_ROOT"` in its macOS
  // lane. Python 3 remains a hard requirement there, and this deletion must
  // never be cited as licence to strip python setup from any workflow.
  // (Deliberately NO `build-platforms.yml:NNN` here. A line number is a pointer
  // into a file somebody else edits, correct only until an insert above it, and
  // nothing recomputes it — the re-cite tax CLAUDE.md measured at 203 and 218
  // broken citations for two single-hunk edits to ci.yml. The grep above finds
  // it in any revision.)
];

// ═════════════════════════════════════════════════════════════════════════════
// THE RUNNER-WALK TABLE — trees a named runner reaches by walking, so no
// reference to their members exists anywhere to be found.
//
// Each row names the RUNNER. That is the whole quality bar: if you cannot name
// the thing that walks the directory, the tree does not belong here, it belongs
// in the exemption table where somebody has to date the claim.
// ═════════════════════════════════════════════════════════════════════════════
const RUNNER_WALKS = [
  {
    test: (p) => /(^|\/)test\//.test(p),
    runner:
      'the test walkers name no file: `melos run test` execs `dart test` / `flutter test` per package ' +
      '(pubspec.yaml melos.scripts.test), `vitest run` walks services/*/test, `node --test` walks ' +
      'tooling/content_pipeline/test, and tsconfig include carries `test/**/*.ts`',
  },
  {
    test: (p) => /(^|\/)RunnerTests\//.test(p),
    runner: 'Xcode runs the RunnerTests target by scheme, not by a file list',
  },
  {
    test: (p) => /^apps\/[^/]+\/(android|ios|linux|macos|windows|web)\//.test(p),
    runner:
      'the platform runner trees are walked by their own toolchain — Gradle (settings.gradle.kts + res/ ' +
      'resource merging), Xcode (.xcodeproj / .xcassets), CMake, and `flutter build` — all of which ' +
      'discover members by directory convention',
  },
  {
    // 🔴 THE EXTENSION TREE IS WALKED BY GLOB, BY ITS OWN PACKER, AND THE
    // MANIFEST OF WHAT SHIPS IS `tool.json`. Added 2026-09-05 with the subtree
    // ([ADR 067] decision 1), after this guard reported 232 findings over it on
    // the first CI run that saw it — 56 `_locales/<lang>/messages.json` alone.
    //
    // Not one of those is dead, and the reason is structural rather than a
    // convention this guard could learn: `extensions/scripts/pack.mjs` builds a
    // package from `tool.json`'s `package.include` GLOBS
    // (`_locales/*/messages.json`, `content/*.js`, `pages/*.js`, `icons/*.png`),
    // and the browser then resolves a locale from `manifest.json`'s
    // `default_locale` at RUNTIME, by directory name. No tracked file names
    // `_locales/am/messages.json`, and adding the 56th language must not require
    // one — that is the same "a member joins by existing" property mason's
    // `__brick__/` has above.
    //
    // ⚠️ WHAT THIS DOES NOT CONCEDE. The extension tree is not unguarded here: it
    // is the only tree in this repository whose shipped set is DECLARED
    // (`package.include` / `package.exclude`) and then CHECKED — `pack.mjs`
    // builds it twice and SHA-256 compares, `check-store-packages.mjs` grades the
    // built zip, `verify-refs.mjs` fails on a reference the package does not
    // carry, and `tooling/ci/assert-extensions-build-free.mjs` refuses anything
    // that would make the shipped bytes differ from the tracked ones. A file that
    // really is dead there is caught by the package it fails to appear in, which
    // is a stronger reader than a path reference.
    test: (p) => /^extensions\//.test(p),
    runner:
      'extensions/scripts/pack.mjs builds each package from the include/exclude GLOBS in that tool\'s ' +
      'tool.json, and the browser resolves _locales/<lang>/ from manifest.json\'s default_locale at ' +
      'runtime — so no tracked file names a member, by design. What ships is declared in tool.json and ' +
      'checked by the double-build SHA-256 compare, check-store-packages.mjs and verify-refs.mjs.',
  },
  {
    test: (p) => /^tooling\/bricks\//.test(p),
    runner:
      'mason generates a brick wholesale from `__brick__/`; its members are templates whose own names ' +
      'carry `{{ }}` placeholders and are never written literally anywhere',
  },
  {
    test: (p) => /^sites\/[^/]+\//.test(p),
    runner:
      'a deploy publishes a whole site root — Cloudflare Git integration for sites/nikatru and ' +
      'sites/rajasekarselvam, and `npm run build` (Eleventy, which discovers _includes/ _data/ and ' +
      '*.njk by convention) for sites/_shared via the ci.yml site_shared job',
  },
  {
    test: (p) => /^\.github\//.test(p),
    runner: 'GitHub reads .github/ by name — Actions runs every file in workflows/, and the rest is convention',
  },
  {
    test: (p) => /^packages\/tokens\/tokens\//.test(p),
    runner: 'style-dictionary reads the token source directory named in packages/tokens/style-dictionary.config.mjs',
  },
  {
    test: (p) => /^tooling\/content_pipeline\/examples\//.test(p),
    runner:
      'the content pipeline DERIVES member names from recipe.json (its `locales` list yields content/hi.json), ' +
      'so no example file is ever named literally',
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// TOOL-CONVENTION BASENAMES — a file some named tool opens BY ITS NAME. Nothing
// references `package.json`; npm looks for it. Same shape as `runner-walk`: the
// tool has to be nameable.
// ═════════════════════════════════════════════════════════════════════════════
const TOOL_CONVENTION = new Map([
  ['README.md', 'GitHub and every file browser render README.md as the directory front page'],
  ['LICENSE', 'the licence is located by name by GitHub and by every scanner'],
  ['package.json', 'npm/pnpm locate it by name'],
  ['package-lock.json', 'npm locates it by name'],
  ['pnpm-lock.yaml', 'pnpm locates it by name'],
  ['pnpm-workspace.yaml', 'pnpm locates it by name'],
  ['tsconfig.json', 'tsc/vitest/wrangler locate it by name'],
  ['vitest.config.ts', 'vitest locates it by name'],
  ['.npmrc', 'npm/pnpm locate it by name'],
  ['.gitignore', 'git locates it by name'],
  ['.gitattributes', 'git locates it by name'],
  ['.editorconfig', 'every editor locates it by name'],
  [
    '.ignore',
    'ripgrep locates it by name — it re-enables gitignored paths for SEARCH only (git never reads it). ' +
      'It no longer re-enables the private corpus: that tree moved OUT to the sibling ' +
      '../Project_Cross_Platform_Apps_Private/ (2026-08-18) and no negation can reach outside the search ' +
      'root, so the file now carries the dated record of why, and the two-root invocation to use instead',
  ],
  ['.gitleaks.toml', 'gitleaks locates its config by name'],
  ['renovate.json', 'Renovate locates its config by name'],
  ['mason.yaml', 'mason locates its brick manifest by name'],
  ['.metadata', 'the flutter tool locates it by name to track the project template version'],
  ['eleventy.config.js', 'Eleventy locates its config by name'],
  ['analysis_options.yaml', 'the Dart analyzer locates it by name'],
  ['l10n.yaml', 'flutter gen-l10n locates it by name'],
  ['pubspec.yaml', 'the Dart/Flutter tool locates it by name'],
  ['pubspec_overrides.yaml', 'melos writes it and the pub resolver locates it by name'],
  ['wrangler.jsonc', 'wrangler locates it by name'],
  ['CMakeLists.txt', 'CMake locates it by name'],
]);

// ═════════════════════════════════════════════════════════════════════════════
// CANARIES (floor F3) — a named file that a NAMED resolver must reach, and two
// that a named resolver must NOT reach. A total can stay healthy while one limb
// dies; these are the limb tests.
//
// A row may also carry `from`, naming the exact tracked file that must be among
// that resolver's sources. `by` alone answers "is anything still reaching it",
// which a lucky prose mention can satisfy; `from` answers "is the RELATIONSHIP
// still there". The `module-import` row below needs the stronger form for a
// concrete reason — its subject was already passing on a comment before the
// resolver existed, so a `by`-only canary on it would have gone green against a
// resolver that resolved nothing.
// ═════════════════════════════════════════════════════════════════════════════
const CANARIES = [
  {
    path: 'tooling/ci/assert-app-dod.mjs',
    by: 'path-reference',
    note: '.github/workflows/ci.yml runs it as `node tooling/ci/assert-app-dod.mjs` — the ordinary case',
  },
  {
    path: 'services/subly-api/src/lib/d1.ts',
    by: 'module-import',
    from: 'services/subly-api/src/routes/budget.ts',
    note:
      'the TypeScript import graph, which was INVISIBLE to this guard until 2026-08-17 — finding (3) in the ' +
      "header. budget.ts:7 carries `import { allRows, firstRow, nowIso, uuid } from '../lib/d1'`, and six " +
      'more tracked files import the same module (four more under src/routes/, src/index.ts, and ' +
      'test/renewals.test.ts). Before the module-import resolver, d1.ts resolved on exactly ONE source and ' +
      'it was not any of the seven: a comment in ' +
      'services/subly-api/src/lib/error-sink.ts reading "same reason `lib/d1.ts` is duplicated". `from` is ' +
      'pinned here rather than `by` alone precisely because that comment would satisfy a `by`-only row while ' +
      'the resolver resolved nothing.',
  },
  {
    path: 'apps/subly/windows/runner/utils.h',
    by: 'sibling-name',
    note:
      'utils.cpp in the same directory carries `#include "utils.h"`. This is the exact file the scoping ' +
      "pass's first scanner called dead, because its reader used an extension allowlist with no `.cpp` in it",
  },
  {
    path: 'apps/subly/assets/icon/app_icon_foreground.svg',
    by: 'unique-name',
    note:
      'tooling/store/render-play-graphics.mjs:124 builds the path with `join(BRAND_DIR, ' +
      "'app_icon_foreground.svg')` — a composed path, so only the bare basename is ever written",
  },
  {
    path: 'apps/subly/assets/brand/nikatru-logo.png',
    by: 'flutter-asset',
    note: 'apps/subly/pubspec.yaml declares the DIRECTORY `assets/brand/`, never the file',
  },
  {
    path: 'packages/analysis/lib/nikatru_lints.dart',
    by: 'package-entry',
    note: 'the public entry point of the package whose pubspec `name:` is nikatru_lints',
  },
  {
    path: 'packages/design_system/test/app_spacing_test.dart',
    by: 'runner-walk',
    note: 'reached only by the melos test walk',
  },
  {
    path: 'tooling/content_pipeline/examples/lingo-phrases/content/hi.json',
    by: 'runner-walk',
    note: 'named by DERIVATION from recipe.json `locales: ["en","fr","hi"]`, never literally',
  },
  {
    path: 'pnpm-workspace.yaml',
    by: 'tool-convention',
    note: 'pnpm opens it by name; nothing points at it',
  },
  // ── NEGATIVE canaries: the two rules that make this guard more than a grep ──
  {
    path: 'sites/nikatru/icon-16.png',
    not: 'unique-name',
    note:
      'finding (2) in the header. Two tracked files are named icon-16.png, so the bare basename cannot ' +
      'choose between them — `sites/rajasekarselvam/index.html:27` links `/icon-16.png`, its OWN copy. ' +
      'Drop the uniqueness condition and this canary fires.',
  },
  {
    path: 'sites/nikatru/icon-16.png',
    not: 'path-reference',
    note:
      'and no tracked file writes `nikatru/icon-16.png`. If this ever starts passing, a real reference ' +
      'was added and the file stopped being an asymmetry between two hand-maintained deploy roots.',
  },
];

// Files that carry LITERAL NUL BYTES ON PURPOSE (sentinels and hash separators)
// and must still be read as TEXT. Naming them here is floor F2 for the binary
// classifier: the obvious "has a NUL byte ⇒ binary" test would drop four real
// reference sources — one of which, assert-public-citations.mjs, is a citation
// checker — and every path they mention would look unreferenced.
const DELIBERATE_NUL_TEXT = [
  'tooling/ci/assert-release-lane-generic.mjs',
  'tooling/ci/assert-update-coverage.mjs',
  'tooling/ci/flutter-stock-assets.mjs',
  'tooling/scripts/assert-public-citations.mjs',
];

// F1. Far below any plausible tree (1211 tracked on 2026-08-17). It is a floor
// against an enumeration that returned NOTHING or a fraction — the wrong cwd, a
// directory that is not a repo, a git that failed after printing some output —
// not a ratchet against tree size. Deleting a quarter of the repo should be
// loud; growing it should cost no edit here.
const MIN_TRACKED = 900;

// ─────────────────────────────────────────────────────────────────────────────
const problems = [];
const notes = [];

function cannotRun(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`    ${l}`);
  process.exit(2);
}

// ── 1 · THE SUBJECT: the tracked manifest, never a filesystem walk ───────────
// SCAN-vs-MANIFEST, the same doctrine as assert-walks-bounded.mjs:146-165. The
// question is "what does this repo publish", and a disk walk answers a different
// one — it descends into ephemeral/, node_modules/, build/ and any nested
// checkout, none of which this repo publishes.
const ls = spawnSync('git', ['ls-files', '-z'], {
  cwd: ROOT,
  encoding: 'buffer',
  maxBuffer: 1 << 28,
});
if (ls.error) cannotRun([`\`git ls-files\` could not be spawned in ${ROOT}: ${ls.error.message}`]);
if (ls.status !== 0) {
  cannotRun([
    `\`git ls-files\` exited ${ls.status} in ${ROOT}.`,
    String(ls.stderr ?? '').trim() || '(no stderr)',
    'The manifest is the subject. Without it this guard would report a clean empty tree.',
  ]);
}
const tracked = ls.stdout.toString('utf8').split('\0').filter(Boolean);
if (tracked.length < MIN_TRACKED) {
  cannotRun([
    `\`git ls-files\` returned ${tracked.length} path(s); the floor is ${MIN_TRACKED}.`,
    'Either this is not the monorepo root, or the enumeration was truncated. A guard that walks an',
    'empty or partial manifest finds nothing dead and prints ok, which is the vacuous pass this file',
    'exists to eliminate.',
  ]);
}
const trackedSet = new Set(tracked);

// ── 1b · HOW FAR THE BODIES HAVE DRIFTED FROM THE MANIFEST ───────────────────
// See "THE RUN IS ONLY AS REPRODUCIBLE AS THE WORKING TREE IS CLEAN" in the
// header. The manifest is the index and the bodies are the working tree; this
// measures the gap instead of leaving the reader to guess at it, and the number
// is printed with the verdict on EVERY run — green or red — because a caveat
// that only appears on failure is a caveat nobody reads.
//
// This is NOT a floor, and it must not become one now that ci.yml runs this
// guard. A dirty tree is the normal state when a session runs it by hand, and
// failing on drift would punish the ordinary case; in CI the checkout is clean by
// construction so the count is always 0 and this limb never speaks. It is a
// qualifier on the answer, never a verdict.
const dirtyTracked = (() => {
  const d = spawnSync('git', ['diff', '--name-only', '-z'], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 1 << 28,
  });
  if (d.error || d.status !== 0) return null; // unknown, and said so rather than assumed clean
  return d.stdout.toString('utf8').split('\0').filter(Boolean);
})();
const driftNote =
  dirtyTracked === null
    ? 'working-tree drift UNKNOWN (`git diff --name-only` failed) — bodies were read from the working tree'
    : dirtyTracked.length === 0
      ? 'working tree clean, so bodies and manifest are the same snapshot'
      : `🔴 ${dirtyTracked.length} tracked file(s) DIFFER from the index (e.g. ${dirtyTracked[0]}) — bodies were ` +
        'read from the working tree, the manifest from the index, so this run is not reproducible from a ' +
        'commit. `git stash -u` and re-run before filing anything from it.';

// ── 2 · READ EVERY TRACKED FILE, and decide text/binary BY CONTENT ───────────
// 🔴 NOT by extension. The scoping pass's first reader used an extension
// allowlist with no `.cpp` in it and reported `flutter_window.h` / `utils.h` as
// dead while the `.cpp` beside each one `#include`s it on line 1. An extension
// allowlist IS a coverage floor and it is always one entry short.
//
// 🔴 AND NOT by "contains a NUL byte" either — see DELIBERATE_NUL_TEXT. The test
// is the RATIO of control bytes, which a source file cannot reach and an image
// cannot avoid.
const bodies = new Map(); // path -> latin1 string ('' for binary)
const isText = new Map();
for (const p of tracked) {
  const abs = join(ROOT, p);
  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    // Tracked but not on disk (a staged deletion, a sparse checkout). It cannot
    // be a reference SOURCE; it is still a subject, and it will resolve or not
    // on what other files say about it.
    bodies.set(p, '');
    isText.set(p, false);
    continue;
  }
  const n = Math.min(buf.length, 8192);
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b === 127) ctrl++;
  }
  const text = n === 0 || ctrl / n < 0.05;
  isText.set(p, text);
  bodies.set(p, text ? buf.toString('latin1') : '');
}
{
  const misread = DELIBERATE_NUL_TEXT.filter((p) => trackedSet.has(p) && !isText.get(p));
  if (misread.length) {
    cannotRun([
      `${misread.length} guard source(s) that carry deliberate NUL bytes were classified BINARY: ${misread.join(', ')}.`,
      'They would then contribute no references at all, and every path they name would look unreferenced.',
      'The binary test is a control-byte RATIO for exactly this reason; it has regressed to something',
      'NUL-sensitive.',
    ]);
  }
}
const textCount = tracked.filter((p) => isText.get(p)).length;

// ── 3 · THE REFERENCE INDEX ──────────────────────────────────────────────────
// Two indexes, both built by scanning the tracked bodies ONCE and keeping only
// tokens that could possibly matter (a suffix of a real tracked path, or a real
// tracked basename). Everything else is discarded as it is read, which is what
// keeps a 9 MB corpus cheap.
const dirSuffixes = (p) => {
  // Every suffix of p carrying at least one directory segment. Empty segments
  // are dropped, so a root-relative `/icon-16.png` yields NOTHING — that is the
  // whole of finding (2), expressed as three lines.
  const seg = p.split('/').filter(Boolean);
  const out = [];
  for (let i = seg.length - 2; i >= 0; i--) out.push(seg.slice(i).join('/'));
  return out;
};

const validSuffix = new Set();
for (const p of tracked) for (const s of dirSuffixes(p)) validSuffix.add(s);

const trackedBasenames = new Map(); // basename -> [paths]
for (const p of tracked) {
  const b = basename(p);
  if (!trackedBasenames.has(b)) trackedBasenames.set(b, []);
  trackedBasenames.get(b).push(p);
}

// `}` and `#` are in the segment class because mason brick paths really contain
// `{{app_id}}` and `{{#needs_backend}}`. That generosity has a cost at the END of
// a token, and it cost two false findings on the first run of this guard:
//
//   tooling/legal/duty-matrix.json:188  "… is docs/legal/privacy-direct-marketing-draft.md."
//   tooling/dod-register.json:577       "… app_icon_foreground.png/.svg, app_icon_maskable.svg}"
//
// A sentence-ending full stop and a closing brace are punctuation, not part of
// the name, so both references were read as tokens that match nothing and both
// files were reported dead while a tracked file names each of them in full. So
// every token is offered twice: as written, and with trailing punctuation
// stripped. No tracked path ends in any of these characters, so the stripped
// variant can only ever ADD a true reference.
const TRAILING_PUNCT = /[.,;:)\]}]+$/;
const variants = (tok) => {
  const bare = tok.replace(TRAILING_PUNCT, '');
  return bare && bare !== tok ? [tok, bare] : [tok];
};

const SEG = '[A-Za-z0-9_.@~+{}$#%-]+';
const RE_PATHISH = new RegExp(`${SEG}(?:[\\\\/]${SEG})+`, 'g');
const RE_NAMEISH = new RegExp(SEG, 'g');

// 🔴 MODULE-SPECIFIER RESOLUTION — finding (3) in the header, as five lines.
//
// `import { allRows } from '../lib/d1'` yields the token `../lib/d1`, whose only
// directory-bearing suffix is `lib/d1`, which is a suffix of no tracked path,
// because the tracked path is `…/lib/d1.ts`. So a JS/TS import resolved to
// NOTHING and the whole module graph was invisible: 80 of the 82 relative
// specifiers under `services/*/src` are extensionless.
//
// A suffix and its token always share a LAST SEGMENT, so "the token carries no
// extension" is decidable here as "the last segment has no dot" — which also
// rejects `.` and `..` for free, so a leading `./` or `../` never expands.
// Candidates are still checked against `validSuffix`, exactly like a literal
// token, so an expansion can only ever match a path that really exists; it can
// never invent one.
//
// The cost is stated rather than hidden: this is GENEROUS, and it is the whole
// house style of this guard (see the design constraint at the top). A prose
// mention of the DIRECTORY `services/subly-api/src/lib` now also reaches
// `…/lib/index.ts` if such a file exists. That is why the result lands in its
// OWN resolver instead of being folded into `path-reference`: `--why` and
// `--list` show which of the two reached a path, floor F2 fails if this limb
// stops resolving entirely, and the F3 canary pins it to a named importer.
const MODULE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];
const moduleCandidates = (s) => {
  const last = s.slice(s.lastIndexOf('/') + 1);
  if (!last || last.includes('.')) return []; // already extensioned, or `.` / `..`
  const out = [];
  for (const e of MODULE_EXTS) {
    out.push(s + e);
    out.push(`${s}/index${e}`);
  }
  return out;
};

// 🔴 THIS FILE IS NOT A REFERENCE SOURCE, AND THAT IS THE SINGLE MOST LOAD-BEARING
// LINE IN THE GUARD.
//
// It is finding (1) from the header, recurring one level up. Every path this file
// names — every `path:` in EXEMPTIONS, every canary, every example in a comment —
// is a literal path token in a tracked file the moment this file is committed. So
// without this exclusion the guard would resurrect, by documenting them, exactly
// the files it exists to find: a `removal-candidate` row would satisfy its own
// waiver, and a path could never be reported again once anybody had written it
// down here.
//
// It was not a hypothesis. The negative canary below caught it: staging this file
// and re-running produced `path-reference now reaches sites/nikatru/icon-16.png,
// and it must not` — because the header explains that very asymmetry and writes
// the path out to do so. The guard's own prose had made a file look alive.
const SELF = resolve(fileURLToPath(import.meta.url))
  .slice(ROOT.length + 1)
  .replace(/\\/g, '/');

const suffixSources = new Map(); // path-suffix -> Set<source path>
const moduleSources = new Map(); // path-suffix -> Set<source path>, via an extensionless specifier
const nameSources = new Map(); // basename    -> Set<source path>
for (const [src, body] of bodies) {
  if (!body || src === SELF) continue;
  for (const m of body.matchAll(RE_PATHISH)) {
    for (const tok of variants(m[0].replace(/\\/g, '/'))) {
      for (const s of dirSuffixes(tok)) {
        if (validSuffix.has(s)) {
          if (!suffixSources.has(s)) suffixSources.set(s, new Set());
          suffixSources.get(s).add(src);
        }
        for (const cand of moduleCandidates(s)) {
          if (!validSuffix.has(cand)) continue;
          if (!moduleSources.has(cand)) moduleSources.set(cand, new Set());
          moduleSources.get(cand).add(src);
        }
      }
    }
  }
  for (const m of body.matchAll(RE_NAMEISH)) {
    for (const tok of variants(m[0])) {
      if (!trackedBasenames.has(tok)) continue;
      if (!nameSources.has(tok)) nameSources.set(tok, new Set());
      nameSources.get(tok).add(src);
    }
  }
}

/** Sources for `key` in `index`, excluding `self`. A file naming its own path in
 *  its own header — which every guard in this repo does, on the `Usage:` line —
 *  must never count as its own reference. */
function othersFor(index, key, self) {
  const set = index.get(key);
  if (!set) return [];
  const out = [];
  for (const s of set) if (s !== self) out.push(s);
  return out;
}

// ── 4 · FLUTTER ASSET DECLARATIONS — parsed, never grepped ───────────────────
// `assert-clone-contract.mjs` records what grepping a manifest costs: a
// `grep '"r2_buckets"'` matched the template COMMENT explaining why there is no
// `r2_buckets`. So this reads the block structurally — find `flutter:` at column
// 0, find `assets:` nested under it, take the list items nested under THAT, and
// stop at the first line whose indent leaves the block.
//
// A DIRECTORY entry (`- assets/brand/`) bundles every member — declared by its
// directory, never by its name. That is why this resolver has to exist at all:
// `apps/subly/lib/features/shared/widgets.dart` names only the two wordmark
// lockups, so without it every other member of a declared directory would read
// as dead.
//
// ⚠️ THIS COMMENT USED TO CITE `assets/brand/nikatru-icon.png` AS THE WORKED
// EXAMPLE — "ships in all six platform builds with no code anywhere loading it".
// It was true, and it was the whole problem: on 2026-08-17 that file was deleted
// as a byte-identical duplicate of the launcher master
// `apps/subly/assets/icon/app_icon_1024.png` (same sha256, 261,948 bytes), which
// is NOT under a declared `assets:` entry and so never shipped. 256 KB rode into
// six bundles on the strength of a directory entry. The mechanism below is
// unchanged; only its illustration is, and it is recorded rather than swapped
// because "a resolver whose example turned out to be the bug" is the reason this
// resolver is generous ON PURPOSE: it keeps such files GREEN here, so nothing in
// this guard would ever have found that one. Bundle bloat is a different
// question from a dead tracked file, and this guard does not answer it.
const assetDirs = []; // { prefix, pubspec }
const assetFiles = new Map(); // path -> pubspec
for (const p of tracked) {
  if (basename(p) !== 'pubspec.yaml') continue;
  const body = bodies.get(p);
  if (!body) continue;
  const pkgDir = dirname(p) === '.' ? '' : `${dirname(p)}/`;
  const lines = body.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, ''));
  const flutterAt = lines.findIndex((l) => /^flutter:\s*$/.test(l));
  if (flutterAt === -1) continue;
  let assetsAt = -1;
  let assetsIndent = -1;
  for (let i = flutterAt + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // left the `flutter:` block
    const m = lines[i].match(/^(\s+)assets:\s*$/);
    if (m) {
      assetsAt = i;
      assetsIndent = m[1].length;
      break;
    }
  }
  if (assetsAt === -1) continue;
  for (let i = assetsAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= assetsIndent) break; // left the `assets:` list
    const m = line.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (!m) continue;
    const entry = m[1];
    if (entry.endsWith('/')) assetDirs.push({ prefix: pkgDir + entry, pubspec: p });
    else assetFiles.set(pkgDir + entry, p);
  }
}

// ── 5 · DART PACKAGE ENTRY POINTS ────────────────────────────────────────────
// `packages/core/lib/nikatru_core.dart` is the file `package:nikatru_core/…`
// resolves through. It is an entry point by pub's convention, and nothing in the
// tree has to name it.
const packageEntries = new Map(); // path -> package name
for (const p of tracked) {
  if (basename(p) !== 'pubspec.yaml') continue;
  const body = bodies.get(p);
  if (!body) continue;
  const m = body.match(/^name:\s*(\S+)\s*$/m);
  if (!m) continue;
  const dir = dirname(p) === '.' ? '' : `${dirname(p)}/`;
  packageEntries.set(`${dir}lib/${m[1]}.dart`, m[1]);
}

// ── 6 · RESOLVE ──────────────────────────────────────────────────────────────
// Every resolver runs for every path — no short-circuit — because the canaries
// in F3 assert that a SPECIFIC resolver reached a specific file, and a
// first-match loop would let a broken limb hide behind a healthy one.
const RESOLVERS = [
  'path-reference',
  'module-import',
  'sibling-name',
  'unique-name',
  'flutter-asset',
  'package-entry',
  'runner-walk',
  'tool-convention',
];
const reasons = new Map(); // path -> Map<resolver, why>
// path -> Map<resolver, source paths>. Only the resolvers that HAVE a nameable
// source populate this; it exists so an F3 canary can assert not merely "some
// resolver reached it" but "THIS file reached it", which is the difference
// between a canary that survives a rewrite of the resolver and one that tests it.
const sourcesOf = new Map();
const resolverHits = new Map(RESOLVERS.map((r) => [r, 0]));

for (const p of tracked) {
  const found = new Map();
  const foundSrc = new Map();
  const add = (r, why, srcs) => {
    if (found.has(r)) return;
    found.set(r, why);
    if (srcs && srcs.length) foundSrc.set(r, srcs);
    resolverHits.set(r, resolverHits.get(r) + 1);
  };

  // path-reference — a suffix of p carrying a directory segment is written down
  // somewhere else. This is the ordinary case and it covers `node tooling/ci/x.mjs`,
  // `package:nikatru_core/src/y.dart`, `import '../models/z.dart'` and an href.
  for (const s of dirSuffixes(p)) {
    const src = othersFor(suffixSources, s, p);
    if (src.length) {
      add('path-reference', `\`${s}\` appears in ${src.length} other tracked file(s), e.g. ${src[0]}`, src);
      break;
    }
  }

  // module-import — an EXTENSIONLESS module specifier that resolves to p under
  // the JS/TS rules. `import … from '../lib/d1'` in routes/budget.ts reaches
  // src/lib/d1.ts here and nowhere else in this guard.
  //
  // Unlike path-reference this does NOT break at the first matching suffix: it
  // unions the sources across every suffix, because the canary asserts a NAMED
  // importer and a first-match loop would make that assertion depend on which
  // suffix happened to match first rather than on whether the importer is real.
  {
    const hits = new Set();
    for (const s of dirSuffixes(p)) for (const q of othersFor(moduleSources, s, p)) hits.add(q);
    if (hits.size) {
      const src = [...hits].sort();
      add(
        'module-import',
        `an extensionless module specifier resolving to it is written by ${src.length} other tracked file(s), e.g. ${src[0]}`,
        src,
      );
    }
  }

  // sibling-name — the basename alone, written by a file in the SAME directory.
  // This is what a relative `#include "utils.h"` or `import 'x.dart'` looks like,
  // and confining it to one directory is what stops it crossing deploy roots.
  {
    const b = basename(p);
    const src = othersFor(nameSources, b, p).filter((q) => dirname(q) === dirname(p));
    if (src.length) add('sibling-name', `\`${b}\` is written by ${src[0]}, in the same directory`);
  }

  // unique-name — the basename alone, written anywhere, but ONLY when exactly one
  // tracked file bears that basename. This is the composed-path case:
  // `join(BRAND_DIR, 'app_icon_foreground.svg')` never writes a directory
  // segment. The uniqueness condition is finding (2): with two `icon-16.png` in
  // the tree, a bare `icon-16.png` cannot say which one it meant, so it says
  // nothing about either.
  {
    const b = basename(p);
    if ((trackedBasenames.get(b) ?? []).length === 1) {
      const src = othersFor(nameSources, b, p);
      if (src.length) add('unique-name', `\`${b}\` is the only tracked file of that name and ${src[0]} writes it`);
    }
  }

  // flutter-asset — declared in a pubspec, by file or by containing directory.
  if (assetFiles.has(p)) add('flutter-asset', `declared in ${assetFiles.get(p)} under \`flutter: assets:\``);
  for (const d of assetDirs) {
    if (p.startsWith(d.prefix)) {
      add('flutter-asset', `inside \`${d.prefix}\`, a DIRECTORY entry under \`flutter: assets:\` in ${d.pubspec}`);
      break;
    }
  }

  // package-entry
  if (packageEntries.has(p)) add('package-entry', `the pub entry point for package \`${packageEntries.get(p)}\``);

  // runner-walk
  for (const w of RUNNER_WALKS) {
    if (w.test(p)) {
      add('runner-walk', w.runner);
      break;
    }
  }

  // tool-convention
  {
    const b = basename(p);
    if (TOOL_CONVENTION.has(b)) add('tool-convention', TOOL_CONVENTION.get(b));
  }

  if (found.size) reasons.set(p, found);
  if (foundSrc.size) sourcesOf.set(p, foundSrc);
}

// ── 7 · FLOOR F2 — every resolver still resolves something ──────────────────
{
  const dead = RESOLVERS.filter((r) => resolverHits.get(r) === 0);
  if (dead.length) {
    cannotRun([
      `${dead.length} resolver(s) reached NOTHING: ${dead.join(', ')}.`,
      'A resolver that silently stops resolving does not report itself — it reclassifies whatever it used',
      'to cover as dead, and this guard then reports the reclassification as a finding. Repair the',
      'resolver; do not waive its former subjects.',
    ]);
  }
}

// ── 8 · FLOOR F3 — the named canaries ───────────────────────────────────────
{
  const broken = [];
  for (const c of CANARIES) {
    if (!trackedSet.has(c.path)) {
      broken.push(`${c.path} is not tracked, so the canary tests nothing. Re-point it at a live file. (${c.note})`);
      continue;
    }
    const got = reasons.get(c.path) ?? new Map();
    if (c.by && !got.has(c.by)) {
      broken.push(`\`${c.by}\` no longer reaches ${c.path}. ${c.note}`);
    } else if (c.by && c.from) {
      // The stronger form: the resolver must still reach it FROM this file. Only
      // checked once `by` has passed, so a dead limb reports as a dead limb
      // rather than as two findings about the same thing.
      if (!trackedSet.has(c.from)) {
        broken.push(
          `the canary for ${c.path} names ${c.from} as its \`from\`, and that file is not tracked. ` +
            'Re-point the canary at a real consumer. ' +
            c.note,
        );
      } else {
        const src = (sourcesOf.get(c.path) ?? new Map()).get(c.by) ?? [];
        if (!src.includes(c.from)) {
          broken.push(
            `\`${c.by}\` still reaches ${c.path}, but NOT from ${c.from} — it now resolves only via ` +
              `${src.length} other source(s)${src.length ? ` (e.g. ${src[0]})` : ''}. ` +
              'That is the shape of a resolver that stopped resolving while something incidental kept the ' +
              'path alive. ' +
              c.note,
          );
        }
      }
    }
    if (c.not && got.has(c.not)) {
      broken.push(`\`${c.not}\` now reaches ${c.path}, and it must not. ${c.note}`);
    }
  }
  if (broken.length) {
    cannotRun([
      `${broken.length} canary(ies) failed — one limb of the scan has changed behaviour.`,
      ...broken,
    ]);
  }
}

// ── 9 · THE EXEMPTION TABLE, checked against itself and against the tree ────
const exemptPaths = new Set();
{
  const seen = new Set();
  for (const [i, row] of EXEMPTIONS.entries()) {
    const at = `EXEMPTIONS[${i}]`;
    if (!row || typeof row.path !== 'string' || !row.path.trim()) {
      problems.push(`${at} has no \`path\`.`);
      continue;
    }
    if (seen.has(row.path)) {
      problems.push(`${at} waives ${row.path} a second time. Two rows means two reasons, and only one of them is being read.`);
      continue;
    }
    seen.add(row.path);
    if (!KINDS.has(row.kind)) {
      problems.push(`${at} (${row.path}) has kind \`${row.kind}\`, which is not one of: ${[...KINDS].join(', ')}.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.since ?? '')) {
      problems.push(`${at} (${row.path}) has no dated \`since\` (YYYY-MM-DD). An undated waiver cannot be aged out.`);
    }
    if (typeof row.why !== 'string' || row.why.trim().length < 20) {
      problems.push(
        `${at} (${row.path}) has no usable \`why\`. A waiver has to name who opens the file or what keeps it; ` +
          'a category is not a reason, which is what `kind` is already for.',
      );
    }

    // 🔴 THE ANTI-ROT LIMB. A waiver must not outlive the thing it waived. The
    // same floor check-selection-record.mjs:132 applies to its EXEMPT set, and
    // for the same reason: once the name stops resolving, the claim is about
    // nothing — and worse, a future file arriving at that path silently inherits
    // a waiver written for something else.
    const onDisk = existsSync(join(ROOT, row.path));
    if (!trackedSet.has(row.path) && !onDisk) {
      problems.push(
        `${at} waives ${row.path}, which is neither tracked nor on disk. ` +
          'Delete the row in the same change that deleted the file.',
      );
    } else if (!trackedSet.has(row.path) && onDisk) {
      // Present but untracked: either not committed yet, or `git rm --cached`.
      // Not a finding — the waived thing still exists — but it is not being
      // checked either, so it is printed rather than passed over in silence.
      notes.push(`${row.path} is waived and present on disk but NOT TRACKED, so this guard is not its subject yet.`);
    }
    exemptPaths.add(row.path);

    // Stale permission: waived, but something now reaches it. Deliberately a
    // NOTE and not a finding. The resolvers above are generous by design, so
    // "now reached" is a weak signal — a single new mention in a tracked .md can
    // flip it — and turning somebody's unrelated edit into a red build is
    // precisely the cry-wolf failure this guard is built to avoid. It is printed
    // on EVERY run, which is the guard-sweep doctrine for a declared skip.
    if (trackedSet.has(row.path) && reasons.has(row.path)) {
      const [r] = [...reasons.get(row.path).keys()];
      notes.push(`${row.path} is waived but \`${r}\` now reaches it — a real consumer exists, so the row can go.`);
    }
  }
}

// ── 10 · THE VERDICT ────────────────────────────────────────────────────────
const unreached = tracked.filter((p) => !reasons.has(p) && !exemptPaths.has(p));

if (WHY) {
  const got = reasons.get(WHY);
  console.log(`${WHY}: ${trackedSet.has(WHY) ? 'tracked' : 'NOT TRACKED'}`);
  if (exemptPaths.has(WHY)) console.log('  EXEMPT — see the table in this file');
  if (!got) console.log('  no resolver reaches it');
  else for (const [r, why] of got) console.log(`  ${r} — ${why}`);
  process.exit(0);
}

if (LIST) {
  for (const p of tracked) {
    const got = reasons.get(p);
    const tag = got ? [...got.keys()].join('+') : exemptPaths.has(p) ? 'EXEMPT' : '🔴 UNREACHED';
    console.log(`${tag.padEnd(68)} ${p}`);
  }
}

for (const p of unreached) {
  problems.push(
    `${p} — no resolver reaches it and no exemption waives it. If it is a real entry point, add a dated ` +
      'row to EXEMPTIONS naming who opens it; if it is dead, remove it.',
  );
}

for (const n of notes) console.log(`   note  ${n}`);

if (problems.length) {
  console.error(`✗ ${problems.length} finding(s) over ${tracked.length} tracked path(s):`);
  console.error(`    ${driftNote}`);
  for (const p of problems) console.error(`    · ${p}`);
  console.error('');
  console.error(
    '    Reference sources are the TRACKED files only — `Private/` is gitignored and is deliberately not read,',
  );
  console.error(
    '    because the 2026-08-17 review masked three of its own four findings by writing them down. Prose in a',
  );
  console.error('    tracked file DOES count; prose in Private/ does not.');
  process.exit(1);
}

// Both counts are computed from the tracked set, NOT from EXEMPTIONS.length. The
// first version of this line printed `tracked - EXEMPTIONS.length` and was off by
// one on its very first green run, because a row may waive a path that is present
// but not yet tracked — so the row count and the waived-tracked count are two
// different numbers. A summary line is a claim like any other.
const reachedCount = tracked.filter((p) => reasons.has(p)).length;
const waivedCount = tracked.filter((p) => !reasons.has(p) && exemptPaths.has(p)).length;
console.log(
  `ok  no dead tracked files — ${tracked.length} path(s) checked, ${reachedCount} reached by ` +
    `${RESOLVERS.length} resolver(s), ${waivedCount} waived by name (${EXEMPTIONS.length} row(s) in the table); ` +
    `${textCount} file(s) read as text for references (Private/ deliberately not read).`,
);
console.log(`    ${driftNote}`);
