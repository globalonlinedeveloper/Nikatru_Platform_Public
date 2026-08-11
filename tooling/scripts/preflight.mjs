#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// preflight.mjs — run what CI runs, BEFORE pushing.
//
// 🔴 WHY THIS EXISTS, MEASURED RATHER THAN ASSERTED. On 2026-08-11 four pushes
// in a row were red, and not one of them was a surprise about the CODE — every
// single failure was a check that CI runs and the local session had not:
//
//   PR #291  · `assert-app-dod.mjs`            — a DoD mutation row expired by the
//                                                very edit in the PR. Never run locally.
//   PR #294a · `assert-sworn-store-files.mjs`  — a drifted citation. Never run locally.
//   PR #294a · `dart format` on the STAMPED app — never run locally.
//   PR #294b · `node --test tooling/ci/test/*.test.mjs` — run locally, but as ONE
//                                                FILE (`guards.test.mjs`, 323/323 green)
//                                                while CI runs the whole glob (4358).
//   PR #294c · `assert-sworn-store-files.mjs` AGAIN — the citation was repaired,
//                                                then `dart format` MOVED THE LINE and
//                                                the repair was never re-checked.
//
// The pattern is one sentence: **the local gate was a SUBSET of the CI gate, and
// the difference is exactly where the failures lived.** Each round cost a push, a
// ~6-minute CI wait, and a context switch — for defects that were all detectable
// on this machine in under two minutes.
//
// The last one is the sharpest, because it is not "a check I forgot" but "a check
// I ran, and then invalidated myself": formatting a Dart file moves the lines that
// a sworn store document cites. A citation is only true until something edits
// above it, and `dart format` is something.
//
// ⚠️ THIS SCRIPT IS NOT THE WHOLE CI GATE and does not pretend to be. It is the
// part that runs on THIS machine in minutes. It deliberately does NOT run the
// six-platform build, the live e2e, or anything needing a runner secret. What it
// covers is the class that has actually been failing: guards, fixtures, formats,
// citations and the stamped app.
//
// Usage:  node tooling/scripts/preflight.mjs [--fast]
//         --fast skips the stamped-app leg (mason + flutter analyze), which is
//         the slow one, for iterating on a guard-only change.
// Exit:   0 = safe to push · 1 = CI would have failed, here is what
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAST = process.argv.includes('--fast');

/** Run a command, capture everything, never throw. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const RE_LINES = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10));

// The tree as it was BEFORE any check ran. The last leg compares against this,
// so it reports what the CHECKS wrote rather than what you were already editing.
const TREE_AT_START = run('git', ['status', '--porcelain=v1']).out.trim().split(RE_LINES).filter(Boolean);

const results = [];
function step(name, why, fn) {
  process.stdout.write(`… ${name}\n`);
  const { code, out } = fn();
  results.push({ name, why, code, out });
  process.stdout.write(code === 0 ? `ok   ${name}\n` : `FAIL ${name}\n`);
  // ⬜ An observation prints on a GREEN leg too. A non-blocking advisory nobody
  // ever sees is the "owner-gated gap that quietly becomes permanent" failure
  // this corpus already names — the whole reason those clauses print at all.
  if (code === 0 && /(^|\n)(⬜|COULD NOT LOOK)/.test(out)) {
    process.stdout.write(out.split(/\r?\n/).map((l) => `     ${l}`).join('\n') + '\n');
  }
}

// ── 1 · the guard test suite, THE WHOLE GLOB ────────────────────────────────
// 🔴 THE GLOB, NOT A FILE. Running one suite is how 4358 tests reported as 323.
step(
  'guard suites (whole glob, as ci.yml runs it)',
  'ci.yml runs `node --test "tooling/ci/test/*.test.mjs"`. Running a single file is a SUBSET and hides every other suite.',
  () => run('node', ['--test', '"tooling/ci/test/*.test.mjs"']),
);

// ── 2 · the guards themselves, over the real tree ───────────────────────────
// The sweep asserts COMPLETENESS (every guard ran or is explained), which is
// the property that catches a guard nobody thought to run — the #291 class.
step(
  'guard sweep (every guard run or explained)',
  'assert-app-dod and assert-sworn-store-files both failed CI while never being run locally. The sweep is what reaches them without a hand-kept list.',
  () => run('node', ['tooling/scripts/guard-sweep.mjs']),
);

// ── 3 · format drift, PRINTED, NEVER FAILED ─────────────────────────────────
// 🔴 THIS LEG WAS A HARD FAILURE FOR ONE REVISION AND THAT WAS WRONG. It format-
// checked every tracked .dart file — but ci.yml checks exactly TWO paths,
// `apps/probe` (ci.yml:1983) and `apps/probeapi` (:2095), both STAMPED apps. The
// tree at large has never been format-gated, and three files are unformatted
// today (notifications/…/local_notification_service_stub.dart,
// purchases/…/rail_config.dart, purchases/test/rail_config_url_shape_test.dart).
// Failing on those would have made this script red on a tree CI is perfectly
// happy with — a preflight that cries wolf gets ignored exactly as fast as a
// guard that sleeps, which is this repo's own recorded rule about assert-screen-set.
//
// 📌 THE CONTRACT OF THIS SCRIPT IS: preflight ≡ CI. Anything STRICTER than CI is
// printed as an observation and never blocks. The stamped-app format check, which
// IS what CI runs, lives in leg 5 where the stamp exists.
step(
  'format drift in tracked Dart (printed — CI gates only the STAMPED apps)',
  'ci.yml format-gates apps/probe and apps/probeapi only. Tree-wide drift is real but is NOT a CI failure, so it is surfaced here and never blocks.',
  () => {
    const files = run('git', ['ls-files', '*.dart']).out.split(/\r?\n/).filter(Boolean)
      // The brick template is not parseable Dart — it carries mustache in
      // expression position. CI formats the STAMPED app instead (leg 5).
      .filter((f) => !f.includes('__brick__'));
    if (files.length === 0) return { code: 1, out: 'no Dart files found — the scan stopped reaching them' };
    // 🔴 CHUNKED, BECAUSE THE FIRST VERSION OF THIS LEG FAILED ON ITSELF.
    // Passing ~600 paths in one argv exceeds Windows' 32 KiB command-line limit
    // and `dart` answers "The command line is too long." — which this script
    // then reported as a FORMAT failure. A checker that cannot distinguish "the
    // code is unformatted" from "I could not run" is the same defect class the
    // rest of this repo's guards exist to avoid, arriving inside the tool
    // written to prevent it. 200 keeps every batch well under the limit.
    // 🔴 CHUNKED AT 60, AND THE FIRST TWO ATTEMPTS FAILED ON THEMSELVES. Passing
    // ~278 paths in one argv, and then 200, both exceeded the Windows command
    // line limit; `dart` answered "The command line is too long." and this leg
    // reported it as a FORMAT problem. A checker that cannot tell "the code is
    // unformatted" from "I could not run" is the exact defect the guards in this
    // repo exist to prevent — arriving inside the tool written to prevent it.
    // Hence the explicit could-not-look branch below rather than a bare exit code.
    const CHUNK = 60;
    const drifted = [];
    for (let i = 0; i < files.length; i += CHUNK) {
      const r = run('dart', ['format', '--output=none', '--set-exit-if-changed', ...files.slice(i, i + CHUNK)]);
      if (/command line is too long/i.test(r.out)) {
        return { code: 0, out: `COULD NOT LOOK — the batch of ${CHUNK} still exceeded the command-line limit. Lower CHUNK. (Printed, not failed: this leg never blocks.)` };
      }
      for (const line of r.out.split(/\r?\n/)) {
        if (line.startsWith('Changed ')) drifted.push(line.replace(/^Changed\s+/, ''));
      }
    }
    return {
      code: 0,
      out: drifted.length === 0
        ? `${files.length} tracked Dart file(s) format-clean`
        : `⬜ ${drifted.length} of ${files.length} tracked Dart file(s) are NOT format-clean. CI does not gate these — it gates only the stamped apps — so this is an observation, not a blocker:\n   · ${drifted.join('\n   · ')}`,
    };
  },
);

// ── 4 · citations, RE-CHECKED AFTER FORMATTING ──────────────────────────────
// This is the one that has failed twice, the second time BECAUSE of step 3.
step(
  'sworn store citations (re-checked AFTER format)',
  'A `file.dart:NNN` citation is true only until something edits above it. `dart format` is something. Order matters: this must run after any formatting.',
  () => run('node', ['tooling/ci/assert-sworn-store-files.mjs']),
);

// ── 5 · the stamped app: format + DoD ───────────────────────────────────────
if (!FAST) {
  step(
    'stamped probe (mason + dart format + app DoD)',
    'CI stamps a throwaway probe and formats it; the brick template cannot be formatted directly, so this is the only place that check is real.',
    () => {
      const pub = process.env.LOCALAPPDATA
        ? `${process.env.LOCALAPPDATA}\\Pub\\Cache\\bin`
        : `${process.env.HOME}/.pub-cache/bin`;
      const env = { PATH: `${pub}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` };
      const mason = run('mason', ['make', 'app', '-c', 'tooling/bricks/app/_probe_vars.json', '-o', '.', '--on-conflict', 'overwrite'], { env });
      if (mason.code !== 0) return { code: 1, out: `mason stamp failed:\n${mason.out}` };
      // 🔴 THE FORMAT HALF IS ADVISORY WHEN THE LOCAL SDK IS NOT THE CI PIN, and
      // that is not caution — it is measured. `dart format`'s output is a
      // function of the bundled `dart_style`, so a local Flutter that differs
      // from `flutter-version:` in ci.yml disagrees with CI about files nobody
      // has touched: on 2026-08-11, local 3.44.7 against the pinned 3.44.9
      // reported 18 of 26 STAMPED files "changed" on a tree whose CI format leg
      // was green — including on `main`, with no local edits at all. Hard-failing
      // on that is a preflight that cries wolf, which is the failure this script
      // exists to prevent (same calibration as leg 3).
      const ciPin = (readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
        .match(/flutter-version:\s*([0-9.]+)/) || [])[1] ?? null;
      const localVer = (run('flutter', ['--version']).out.match(/Flutter\s+([0-9.]+)/) || [])[1] ?? null;
      const skewed = ciPin && localVer && ciPin !== localVer;
      const fmt = run('dart', ['format', '--output=none', '--set-exit-if-changed', 'apps/probe']);
      const dod = run('node', ['tooling/ci/assert-app-dod.mjs']);
      if (fmt.code !== 0 && skewed) {
        // Report it, do not fail on it — and say WHY, so nobody "fixes" the
        // formatting to satisfy a toolchain CI does not use.
        fmt.code = 0;
        fmt.out = `⬜ dart format disagrees on the stamped app, but local Flutter ${localVer} != the ci.yml pin ${ciPin}, so this machine's dart_style is not CI's. NOT failed. To make this leg trustworthy, match the pin: flutter version ${ciPin}.\n${fmt.out.split(/\r?\n/).slice(-3).join('\n')}`;
      }
      // 🔴 THE STAMP MUTATES TWO TRACKED FILES — pubspec.yaml gains apps/probe as
      // a workspace member and sites/_shared/_data/apps.json gains its row. Left
      // behind, a later `git add -A` commits the throwaway probe's registration.
      run('git', ['checkout', '--', 'pubspec.yaml', 'sites/_shared/_data/apps.json']);
      if (existsSync(resolve(ROOT, 'apps/probe'))) rmSync(resolve(ROOT, 'apps/probe'), { recursive: true, force: true });
      return fmt.code !== 0 || dod.code !== 0
        ? { code: 1, out: `${fmt.code !== 0 ? `dart format (stamped):\n${fmt.out}\n` : ''}${dod.code !== 0 ? `assert-app-dod:\n${dod.out}` : ''}` }
        : { code: 0, out: `${fmt.out}\n${dod.out}` };
    },
  );
}

// ── 6 · the tree must be CLEAN, or the push does not carry what was tested ──
// Several checks above write (assert-guard-coverage ratchets its manifest; the
// stamp registers a probe). A dirty tree at the end means the thing proven green
// is not the thing about to be pushed.
step(
  'the checks did not edit the tree behind you',
  'assert-guard-coverage rewrites coverage-manifest.json and the stamp edits pubspec.yaml + apps.json. Anything a CHECK wrote must be seen and committed deliberately, not carried along unnoticed.',
  () => {
    // 🔴 THE DELTA, NOT THE STATE. The first version of this leg failed whenever
    // the tree was dirty — which is ALWAYS, because preflight is what you run
    // BEFORE committing. It would have gone red on every honest run, and a check
    // that is red every time is a check people stop reading: the same cry-wolf
    // failure this script's own leg 3 was corrected for, twice in one file.
    // What it is actually for is narrower and real — several legs above WRITE
    // (the coverage manifest self-ratchets; the stamp registers a probe in two
    // TRACKED files) — so it compares against the snapshot taken at start-up and
    // reports only what THIS RUN changed.
    const now = run('git', ['status', '--porcelain=v1']).out.trim().split(/\r?\n/).filter(Boolean);
    const before = new Set(TREE_AT_START);
    const written = now.filter((l) => !before.has(l));
    return written.length === 0
      ? { code: 0, out: `no check wrote to the tree (${now.length} pre-existing change(s) left alone)` }
      : { code: 1, out: `A CHECK EDITED THESE — review and commit deliberately, or revert:\n${written.join('\n')}` };
  },
);

// ── verdict ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.code !== 0);
console.log('\n' + '─'.repeat(78));
if (failed.length === 0) {
  console.log(`preflight: ok — ${results.length} leg(s) green${FAST ? ' (--fast: stamped-app leg skipped)' : ''}. CI should agree.`);
  process.exit(0);
}
for (const f of failed) {
  console.log(`\nFAIL  ${f.name}`);
  console.log(`      WHY THIS LEG EXISTS: ${f.why}`);
  console.log(f.out.split(/\r?\n/).slice(-40).map((l) => `      ${l}`).join('\n'));
}
console.log(`\npreflight: ${failed.length} of ${results.length} leg(s) FAILED — this is what CI would have told you in six minutes.`);
process.exit(1);
