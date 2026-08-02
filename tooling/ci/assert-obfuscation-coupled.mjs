#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-obfuscation-coupled.mjs — obfuscation and symbol upload are ONE
// increment, or neither.
//
// [pipeline 9]R-7 "Release builds are obfuscated with split debug info, and the
//                  symbols are retained so a crash report can still be read."
//
// ── WHY THIS IS A GUARD AND NOT A BUILD FLAG ─────────────────────────────────
// `--obfuscate --split-debug-info=<dir>` renames every Dart symbol in the AOT
// snapshot and writes the mapping to <dir>. The binary gets smaller and harder
// to read; so does every crash report it will ever produce. The mapping file is
// the ONLY thing that turns `_x12a` back into `SubscriptionRepository.refresh`,
// and it exists for exactly as long as the runner that produced it.
//
// So the failure this exists for is not "we forgot to obfuscate". It is the
// OTHER order: somebody adds `--obfuscate` because it is obviously good, the
// build goes green, nothing anywhere uploads the symbol directory, and the
// regression surfaces WEEKS LATER as a GlitchTip issue nobody can read — at
// which point the symbols for that release are gone and cannot be regenerated,
// because a rebuild produces a different mapping. There is no recovery, only a
// re-release. One flag, added in good faith, permanently blinds the crash sink
// for every build between it and the fix.
//
// The repository is currently on the safe side of that: zero build commands
// carry either flag (measured 2026-08-03). This guard exists so the day
// somebody adds one is the day they also add the upload, rather than the day
// six weeks later when a crash needs reading.
//
// ── WHAT COUNTS AS RETAINING THE SYMBOLS ─────────────────────────────────────
// Two shapes, both real, and the guard accepts either IN THE SAME JOB:
//   (a) a symbol upload to the crash sink — `sentry-cli … debug-files upload`,
//       `upload-dif`, `sentry_dart_plugin`, `upload-symbols`, an .dSYM upload;
//   (b) an `actions/upload-artifact` step whose `path:` names the SAME
//       directory the build passed to `--split-debug-info`.
// (b) is weaker than (a) — a 7-day retention is not an archive — but it is a
// real, checkable relationship, and refusing it would push the first honest
// implementation into disabling the guard. What is NOT accepted is an upload of
// some other directory, which is the shape that looks like coverage and is not.
//
// ── HOW IT MATCHES, AND WHY THAT IS THE CAREFUL PART ─────────────────────────
// 🔴 THE FLAG ON A BUILD COMMAND, NEVER THE BARE WORD. `.symbols` as a token
// matches `apps/subly/.gitignore:37`; the word "obfuscated" appears in a doc
// comment at `packages/platform_storage/lib/src/storage_capabilities.dart:43`.
// A guard that matched either would fire on correct input on day one and be
// switched off. Comments are blanked before anything is read — the
// `assert-stamp-platforms.mjs:37-42` lesson, where a comment kept a guard green
// after the real build step was deleted.
//
// ── CARRIED AS NOTES, NOT AS CODE ────────────────────────────────────────────
// · Breadcrumbs and `FlutterError.onError` belong BEFORE obfuscation, not after
//   — stage 11's to build. Obfuscating first makes the sink less useful, not
//   more.
// · Symbol upload targets the self-hosted GlitchTip whose DSN is already a
//   config key, so (a) needs no new credential surface — it needs an auth token,
//   which is owner work.
// · "Flutter Web has no symbol obfuscation at all" is UNVERIFIED — it rests on
//   a corpus summary, not a primary source — so NO web exemption is hard-coded
//   on it. If a web build ever passes `--obfuscate`, this guard asks the same
//   question it asks of every other target, and the answer can be "the flag was
//   a no-op, delete it".
//
// Usage:  node tooling/ci/assert-obfuscation-coupled.mjs [repoRoot]
// Exit 0 = no build obfuscates without retaining its symbols.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllWorkflows, shellSegments } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** A Flutter build command. `web-server` is a dev server, not an artifact. */
const BUILD_CMD = /flutter\s+build\s+(?!web-server\b)\S+/;

/** The two flags that make a build unreadable without its mapping file. */
const OBFUSCATE = /--obfuscate\b/;
const SPLIT_DEBUG = /--split-debug-info(?:=|\s+)(\S+)/;

/** (a) — a real symbol upload to a crash sink. Named, not heuristic: a
 *  heuristic that stops matching reports "clean", which is the failure mode
 *  this whole family of guards exists to remove. */
const SYMBOL_UPLOAD = [
  /sentry-cli[^\n]*\b(debug-files|difutil)\b[^\n]*\bupload\b/,
  /sentry-cli[^\n]*\bupload-dif\b/,
  /sentry-cli[^\n]*\bupload-dsym\b/,
  /sentry_dart_plugin/,
  /upload-symbols/,
  /getsentry\/action-release/,
  /symbol-collector/,
];

const problems = [];
const notes = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-obfuscation-coupled: FAILED');
  process.exit(1);
}

const workflows = parseAllWorkflows(ROOT);
if (workflows.length === 0) {
  coverageLost([
    `no workflow files were parsed under ${ROOT}/.github/workflows.`,
    'Every question below is asked of build commands in workflows. With none read, the guard would',
    'report "no build obfuscates without retaining its symbols" over an empty set — the exact shape',
    'this repo has shipped twice.',
  ]);
}

// A stripper that ate the file makes every question below run over an empty
// string and answer "nothing to check".
for (const wf of workflows) {
  if (wf.rawStepCount > 0 && wf.strippedStepCount === 0) {
    coverageLost([
      `${wf.rel} has ${wf.rawStepCount} step(s) and NONE survived comment stripping.`,
      'The build-command scan below would then range over nothing and print ok.',
    ]);
  }
}

/** Every `path:` value inside a job, one per line — enough to answer "does an
 *  upload step name this directory" without a full YAML model. */
const uploadedPaths = (job) => {
  const out = [];
  let inUpload = false;
  for (const l of job.logical) {
    if (/^\s*-\s+(uses|name):/.test(l.text)) inUpload = false;
    if (/actions\/upload-artifact/.test(l.text)) inUpload = true;
    if (!inUpload) continue;
    const m = l.text.match(/^\s*(?:path:\s*)?(\S.*?)\s*$/);
    if (m && !/^(?:-\s+)?(uses|with|name|if|id):/.test(m[1])) out.push(m[1].replace(/^path:\s*/, '').replace(/^-\s*/, ''));
  }
  return out;
};

let buildsChecked = 0;
let obfuscating = 0;

for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    const jobText = job.logical.map((l) => l.text).join('\n');
    const hasSinkUpload = SYMBOL_UPLOAD.some((re) => re.test(jobText));
    const paths = uploadedPaths(job);

    for (const l of job.logical) {
      for (const seg of shellSegments(l.text)) {
        if (!BUILD_CMD.test(seg)) continue;
        buildsChecked++;
        const obf = OBFUSCATE.test(seg);
        const split = SPLIT_DEBUG.exec(seg);
        if (!obf && !split) continue;
        obfuscating++;

        const at = `${wf.rel}:${l.n} (job "${job.name}")`;

        // The two flags travel together or the build is broken in a way no
        // upload can repair: `--obfuscate` with no `--split-debug-info` writes
        // NO mapping file anywhere, so the symbols do not exist to be kept.
        if (obf && !split) {
          problems.push(
            `${at} passes --obfuscate with no --split-debug-info. Flutter then writes no symbol mapping ` +
              'at all, so every crash report from this build is permanently unreadable — there is nothing ' +
              'to upload and nothing to recover. The two flags are one flag.',
          );
          continue;
        }
        if (!obf && split) {
          // Harmless on its own (symbols split out of a non-obfuscated binary
          // are still readable in the binary), so this is a NOTE, not a failure.
          notes.push(`${at} passes --split-debug-info without --obfuscate — the binary is still readable, so nothing is lost; the flag is doing less than it looks like.`);
          continue;
        }

        const dir = split[1].replace(/^['"]|['"]$/g, '');
        const named = paths.some((p) => p.includes(dir) || dir.includes(p.replace(/\/\*+$/, '')));
        if (hasSinkUpload || named) continue;

        problems.push(
          `${at} obfuscates into "${dir}" and nothing in job "${job.name}" retains it. ` +
            'A rebuild produces a DIFFERENT mapping, so the symbols for this release exist only on this ' +
            'runner and only until it is reclaimed — after that every crash report from the build is ' +
            'unreadable and cannot be made readable. Upload the symbols to the crash sink in the same ' +
            `job, or upload "${dir}" as an artifact in the same job, or drop --obfuscate.`,
        );
      }
    }
  }
}

if (buildsChecked === 0) {
  coverageLost([
    `parsed ${workflows.length} workflow file(s) and found ZERO \`flutter build\` commands.`,
    'This guard only ever speaks about build commands, so with none found it has nothing to say and',
    'would say "ok" — indistinguishable from a matcher that has stopped matching. build-platforms.yml',
    'alone carries six.',
  ]);
}

if (problems.length) {
  console.error(`✗ obfuscation coupling — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 9]R-7 — obfuscation and symbol retention are one increment or neither.');
  console.error('  See the header of tooling/ci/assert-obfuscation-coupled.mjs for why the order matters.');
  process.exit(1);
}

if (notes.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  obfuscation coupling — ${workflows.length} workflow(s), ${buildsChecked} \`flutter build\` command(s), ` +
    `${obfuscating} obfuscating; every obfuscating build retains its symbol mapping in its own job`,
);
