#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// darwin-inputs.mjs — did anything a Darwin (macOS / iOS) leg depends on change?
//
// ⏱ 2026-10-01 (lead db0cc7's follow-up to the 2026-09 macOS exception in
// tooling/ci/assert-runner-budget.mjs, MACOS_CEILING_EXCEPTIONS). 2026-09 spent 873
// macOS minutes against a ceiling of 200; native-auth-proof.yml's Darwin legs were
// ~282 of them, and each dispatch ran its ios and macos jobs (×10 billing) whether
// or not anything Darwin had changed since that app's last green proof. This
// answers that question, so those two jobs run only when it is yes.
//
// ── WHAT IS A DARWIN INPUT — BY CONTENT, NOT BY A PATH LIST ──────────────────
// A path list goes stale the day a Darwin dependency lands somewhere it does not
// name. So a changed file is judged by what it IS and what it SAYS:
//   · a Darwin-native file by its kind: Swift / Objective-C sources, plists,
//     xcconfigs, entitlements, privacy manifests, Xcode project files, CocoaPods
//     files, or any file under an `ios/`, `macos/` or `darwin/` directory;
//   · a workflow whose TEXT runs a job on a macOS runner (`macos-<n>` on a
//     `runs-on:` line or in the matrix `os:` it reads);
//   · any other text file whose TEXT names a Darwin target or toolchain (iOS,
//     macOS, Darwin, Xcode, xcrun, simctl, App Attest, Apple, App Store, Swift,
//     codesign) — the platform Worker's attestation route, the proof driver, the
//     pubspec.lock entries of the darwin plugins all say so themselves.
// Over-inclusion runs the legs, which is the safe direction; a file that names
// no Darwin thing and is no Darwin kind cannot change what a Darwin leg does.
// A file the diff DELETED is judged by its text at the base.
//
// ── WHEN IT ANSWERS "true" WITHOUT LOOKING ───────────────────────────────────
// No green proof of this app to compare with, a base this checkout does not
// have, a diff git cannot produce, a runs listing the API refuses: the answer is
// darwin=true with the reason printed. Not knowing runs the legs; it never
// skips them.
//
// ── ITS OWN COVERAGE SELF-CHECK ──────────────────────────────────────────────
// Before any verdict, the map is run over the whole tracked tree. A tree in which
// it finds no Darwin-native file and no macOS workflow is a map that has gone
// blind (a rule renamed away, a checkout of nothing): COVERAGE LOST, exit 2,
// never a "false" that would quietly skip every Darwin leg.
//
// Usage:  node tooling/ci/darwin-inputs.mjs --base <sha> [--head <ref>]
//         node tooling/ci/darwin-inputs.mjs --since-green <workflow file> --app <id>
//           (reads GITHUB_REPOSITORY and GITHUB_TOKEN; the base is the head commit
//            of the newest successful run of that workflow for that app)
// Prints the reasons, then `darwin=true|false` as the LAST line of stdout, ready
// for $GITHUB_OUTPUT. Exit 0 with a verdict · 2 COVERAGE LOST or a usage error.
// Tests:  tooling/ci/test/darwin-inputs.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchoredRunRead, GITHUB_API } from './anchored-run-read.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Darwin-native by kind: the file's extension or name. */
const DARWIN_KIND = /\.(swift|m|mm|h|plist|xcconfig|entitlements|xcprivacy|pbxproj|xcscheme|xcworkspacedata|storyboard|xib|podspec)$|(^|\/)(Podfile|Podfile\.lock)$/;
/** Darwin-native by place: a native Darwin project directory. */
const DARWIN_DIR = /(^|\/)(ios|macos|darwin)\//;
/** A workflow job on a macOS runner — on its `runs-on:` line or through a matrix `os:` it reads. */
const MACOS_RUNNER = /\bmacos-(?:\d+|latest)\b/;
/** A text that names a Darwin target or toolchain. Bounded by letters and digits
 *  only, so a plugin name such as `flutter_secure_storage_darwin` or
 *  `url_launcher_ios` in pubspec.lock counts, and `radios` does not. */
const DARWIN_TEXT = /(?<![A-Za-z0-9])(?:ios|macos|darwin|xcode(?:build)?|xcrun|simctl|app[ -]?attest|apple|app ?store|testflight|swift|codesign|cocoapods)(?![A-Za-z0-9])/i;

/**
 * PURE. Why [path] is a Darwin input given its [text], or null when it is not.
 * `text` is the file's content ('' when it is binary or unreadable).
 */
export function darwinInputReason(path, text = '') {
  const p = String(path).replaceAll('\\', '/');
  if (DARWIN_KIND.test(p)) return 'a Darwin-native file (its kind)';
  if (DARWIN_DIR.test(p)) return 'a file of a native Darwin project (an ios/, macos/ or darwin/ directory)';
  const t = String(text ?? '');
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) {
    return MACOS_RUNNER.test(t) ? 'a workflow that runs a job on a macOS runner' : null;
  }
  const m = DARWIN_TEXT.exec(t);
  return m ? `its text names a Darwin target or toolchain ("${m[0]}")` : null;
}

/** PURE. The verdict over `[{ path, text }]`: `{ darwin, reasons: [{ path, why }] }`. */
export function darwinVerdict(files) {
  const reasons = [];
  for (const f of files) {
    const why = darwinInputReason(f.path, f.text);
    if (why) reasons.push({ path: f.path, why });
  }
  return { darwin: reasons.length > 0, reasons };
}

/** PURE. The base commit: the head of the newest successful run of [workflow] for [app]. */
export function lastGreenSha(runs, app) {
  const mine = (runs ?? []).filter(
    (r) => r?.conclusion === 'success' && typeof r?.head_sha === 'string' && new RegExp(`(?:^|\\s)${app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(String(r.display_title ?? '')),
  );
  mine.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  return mine[0]?.head_sha ?? null;
}

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: (r.stderr ?? '').trim() };
}

/** A blob's text, '' when it is binary or absent at that commit. */
function textAt(root, ref, path) {
  const r = spawnSync('git', ['-C', root, 'show', `${ref}:${path}`], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout || r.stdout.includes(0)) return '';
  return r.stdout.toString('utf8');
}

/** The changed files between [base] and [head], each with the text that decides it. */
export function changedFiles(root, base, head) {
  if (!git(root, ['cat-file', '-e', `${base}^{commit}`]).ok) return { error: `the base ${base} is not a commit in this checkout` };
  const d = git(root, ['diff', '--name-status', '--no-renames', '-z', `${base}`, `${head}`]);
  if (!d.ok) return { error: `git diff ${base} ${head} failed: ${d.err}` };
  const parts = d.out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const path = parts[i + 1];
    files.push({ path, text: textAt(root, status === 'D' ? base : head, path) });
  }
  return { files };
}

/** THE SELF-CHECK: the map run over the tracked tree must find Darwin in it. */
export function treeDarwinCount(root) {
  const ls = git(root, ['ls-files', '-z']);
  if (!ls.ok) return { error: `git ls-files failed: ${ls.err}` };
  let native = 0;
  let workflows = 0;
  for (const p of ls.out.split('\0').filter(Boolean)) {
    if (DARWIN_KIND.test(p) || DARWIN_DIR.test(p)) native++;
    else if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) && darwinInputReason(p, textAt(root, 'HEAD', p))) workflows++;
  }
  return { native, workflows };
}

function arg(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

/** The CLI. `out` and `err` are line sinks; `env` and `read` (anchoredRunRead's
 *  injectable `(url, { signal }) => body`) are the API seam. */
export async function main(argv = process.argv.slice(2), { root = ROOT, out = console.log, err = console.error, env = process.env, read = null, retry = {} } = {}) {
  const verdict = (darwin, why) => {
    out(`darwin-inputs: ${why}`);
    out(`darwin=${darwin}`);
    return 0;
  };
  const self = treeDarwinCount(root);
  if (self.error || self.native === 0 || self.workflows === 0) {
    coverageLost(err, self.error ?? `the map found ${self.native ?? 0} Darwin-native file(s) and ${self.workflows ?? 0} macOS workflow(s) in the tracked tree — it has gone blind, and a "false" from it would skip every Darwin leg on nothing.`);
    return 2;
  }
  out(`darwin-inputs: the map reads ${self.native} Darwin-native file(s) and ${self.workflows} macOS workflow(s) in this tree`);

  let base = arg(argv, '--base');
  const head = arg(argv, '--head') ?? 'HEAD';
  const sinceGreen = arg(argv, '--since-green');
  if (sinceGreen !== undefined) {
    const app = arg(argv, '--app');
    if (!app) {
      err('darwin-inputs: --since-green needs --app <id>');
      return 2;
    }
    const repo = env.GITHUB_REPOSITORY;
    if (!repo || !env.GITHUB_TOKEN) return verdict(true, 'no GITHUB_REPOSITORY or GITHUB_TOKEN to find the last green proof — running the Darwin legs');
    // Through the ONE anchored run-history reader (run-page-anchor.test.mjs E5): its
    // bounded retry, and the union of the page with its cross-reads. A stale page
    // can only hide a NEWER green, which makes the diff longer — never shorter.
    try {
      const page = await anchoredRunRead({
        workflow: sinceGreen,
        url: `${GITHUB_API}/repos/${repo}/actions/workflows/${encodeURIComponent(sinceGreen)}/runs?status=success&per_page=100`,
        token: env.GITHUB_TOKEN,
        read,
        retry,
        label: `${sinceGreen} successful runs`,
        what: `the successful runs of ${sinceGreen}`,
      });
      base = lastGreenSha(page.union, app);
    } catch (e) {
      return verdict(true, `the runs listing could not be read (${e?.message ?? e}) — running the Darwin legs`);
    }
    if (!base) return verdict(true, `no successful ${sinceGreen} run for ${app} to compare with — running the Darwin legs`);
    out(`darwin-inputs: the last green ${sinceGreen} for ${app} ran at ${base}`);
  }
  if (!base) {
    err('darwin-inputs: give --base <sha>, or --since-green <workflow> --app <id>');
    return 2;
  }
  const c = changedFiles(root, base, head);
  if (c.error) return verdict(true, `${c.error} — running the Darwin legs`);
  const v = darwinVerdict(c.files);
  for (const r of v.reasons.slice(0, 50)) out(`darwin-inputs:   ${r.path} — ${r.why}`);
  if (v.reasons.length > 50) out(`darwin-inputs:   … and ${v.reasons.length - 50} more`);
  return verdict(
    v.darwin,
    v.darwin
      ? `${v.reasons.length} of ${c.files.length} changed file(s) since ${base.slice(0, 8)} are Darwin inputs — the Darwin legs run`
      : `none of ${c.files.length} changed file(s) since ${base.slice(0, 8)} is a Darwin input — the Darwin legs are not needed`,
  );
}

/** The one COVERAGE LOST stop: printed through the caller's sink, and exit 2 when
 *  this file is the process (main also returns 2, for a caller that imported it). */
function coverageLost(err, why) {
  err(`darwin-inputs: COVERAGE LOST — ${why}`);
  if (IS_MAIN) process.exitCode = 2;
}

const IS_MAIN = (() => {
  try {
    return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (IS_MAIN) {
  main().then(
    (code) => { process.exitCode = code; },
    (e) => { console.error(`darwin-inputs: COVERAGE LOST — crashed: ${e?.stack ?? e}`); process.exitCode = 2; },
  );
}
