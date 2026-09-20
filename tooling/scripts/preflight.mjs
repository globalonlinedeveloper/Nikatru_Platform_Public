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
// 🔴 2026-09-19 — THE SWEEP LEG PASSED A DETERMINISTIC REGRESSION, ON A REAL PR.
// PR #818 went red in CI on "Guards — the guards can still fail": ci.yml runs
// `node tooling/ci/assert-walks-bounded.mjs` with no arguments and it exited 1 on
// a new `readdirSync` in assert-ungraded-baseline-doc.mjs. `preflight.mjs --fast`
// had exited 0 on the same tree. Reproduced: guard-sweep.mjs printed
// `✗ assert-walks-bounded.mjs RED(1) no invocation passes here` and exited 0 —
// correctly, because it asserts COMPLETENESS, and some guards are red on this
// machine for environmental reasons (assert-ops-register, assert-store-matrix
// --registry-only, the assert-stamp-* guards that need a stamped app). This leg
// read only the sweep's exit code, so a red that the BRANCH caused and a red the
// MACHINE causes were the same green line, followed by "CI should agree".
//
// A hand-kept allowlist of "known red" guards was rejected: it is a second copy
// of the tree's state, stale the day after it is written, and it would pass a
// NEW finding in an allowlisted guard. The leg now asks the question directly —
// is this red NEW? — by re-running every RED guard, with the invocations the
// sweep tried, against a clean detached checkout of `git merge-base HEAD
// origin/main` (see `rerunRedsOnBase`). Red here and green there = REGRESSION,
// the leg fails. Red on both with the same exit code = ENVIRONMENTAL, printed.
// Anything that stops the base answering = COVERAGE LOST, and the leg FAILS: a
// red this script cannot explain is exactly the case in which "CI should agree"
// is unfounded, and passing it is the defect above in a politer voice. Only the
// red guards re-run, so the cost is a worktree checkout plus a handful of guards.
//
// 🔴 2026-09-19, AGAIN — PREFLIGHT RAN OVER A TREE CI WOULD NEVER SEE. Twice in
// one day a helper ran `preflight --fast` while its NEW files were still
// untracked, and preflight went green on them:
//   PR #819        assert-mechanism-claims reads `git ls-files`, so it never saw
//                  a new test file's claim sentence. CI committed the file, read
//                  the sentence, and failed.
//   PR #824, #825  `gen-start-here.mjs --check` counts tracked files, guards and
//                  test files from `git ls-files --cached`. Locally it matched;
//                  CI run 35449581752 failed "START-HERE.md differs from what the
//                  tree generates" because the new package, workflow and tests
//                  were untracked when preflight ran and committed when CI did.
// The closing line "CI should agree" cannot be true while the two trees differ:
// every index-reading guard and generator judged the LAST commit, not this one
// (TRAPS vacuous-10). So the FIRST leg now lists untracked, non-ignored files
// and refuses naming them, with the one-line fix: `git add -N <paths>` —
// intent-to-add puts the path in the index with no content staged, and both
// readers above count it — or commit them. It stops the run: every later leg's
// verdict would be about a tree CI does not have, and the full suite is ten
// minutes of laptop the backup shares. `.worktrees/` is skipped by name because
// it is NOT gitignored (measured 2026-09-19: the main checkout lists each
// worktree as an untracked directory) and holds other checkouts, not this one.
//
// 🔴 2026-09-19, A THIRD TIME — "ONE HEAVY RUN AT A TIME" WAS A SENTENCE. Every
// helper brief said: check the backup task is not Running and no other preflight
// is running, then start. Check-then-start is not atomic: at 21:11-21:12 three
// lanes each checked, saw nothing, and started the full suite and this script at
// once, and each took ~1 h instead of ~25 min. Earlier that day the same kind of
// fan-out CPU-starved the offsite backup until it was killed at its 2 h limit,
// missed its heartbeat, and turned ops-watch and main CI red. So once the
// untracked leg is green (it is one `git ls-files`, and stays lock-free, as does
// --untracked-only), this script takes the machine-wide heavy-run lock
// (tooling/scripts/heavy-lock.mjs: an O_EXCL lock file, stale-pid and age
// reclaim, released on exit) and then waits while the 'NIKATRU daily backup'
// task is Running — both inside one --lock-wait ceiling, past which it exits 2
// naming the holder. With CI set, both are skipped: a hosted runner has neither.
// Anything else heavy runs under the same lock through tooling/scripts/heavy.mjs.
//
// Usage:  node tooling/scripts/preflight.mjs [--fast] [--sweep-only] [--untracked-only] [--base <ref>] [--lock-wait <min>]
//         --fast skips the stamped-app leg (mason + flutter analyze), which is
//         the slow one, for iterating on a guard-only change.
//         --sweep-only runs the untracked-files leg, then the guard-sweep leg
//         (with its base re-run). The untracked leg is a single `git ls-files`
//         and the sweep's guards read the index too, so it is not optional there.
//         --untracked-only runs the untracked-files leg alone.
//         --base <ref> compares the sweep's reds against merge-base(HEAD, <ref>)
//         instead of origin/main. No fetch happens: the local ref is used as is.
//         --lock-wait <min> is the ceiling on waiting for the heavy-run lock and
//         the backup task together (default 90).
// Exit:   0 = safe to push · 1 = CI would have failed, here is what
//         2 = a usage error, or COVERAGE LOST: the heavy-run lock or the backup
//             did not free up within --lock-wait, and no heavy leg ran
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAST = process.argv.includes('--fast');
const SWEEP_ONLY = process.argv.includes('--sweep-only');
const UNTRACKED_ONLY = process.argv.includes('--untracked-only');
const SWEEP_LEG = 'guard sweep (every guard run or explained; reds judged against main)';
const UNTRACKED_LEG = 'no untracked files (the index CI commits is the index the guards read)';
/** Imported by tooling/ci/test/preflight-sweep-regression.test.mjs for its
 *  exports; only a direct `node preflight.mjs` runs the legs. */
const IS_MAIN = (() => {
  const a = process.argv[1];
  if (!a) return false;
  const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(fileURLToPath(import.meta.url));
})();
const BASE_REF = (() => {
  const i = process.argv.indexOf('--base');
  if (i === -1) return 'origin/main';
  const v = process.argv[i + 1];
  if (!IS_MAIN) return 'origin/main';
  if (v === undefined || v.startsWith('-')) {
    console.error('✗ --base needs a git ref after it (got ' + (v === undefined ? 'nothing' : `\`${v}\``) + ').');
    process.exit(2);
  }
  return v;
})();
/** Minutes to wait for the heavy-run lock and the backup, together. Read only
 *  when run directly, like --base; an import never parses the argv. */
const LOCK_WAIT_MIN = (() => {
  const i = process.argv.indexOf('--lock-wait');
  if (i === -1 || !IS_MAIN) return undefined;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v < 0) {
    console.error(`✗ --lock-wait needs a number of minutes after it (got ${process.argv[i + 1] === undefined ? 'nothing' : `\`${process.argv[i + 1]}\``}).`);
    process.exit(2);
  }
  return v;
})();

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
const TREE_AT_START = IS_MAIN ? run('git', ['status', '--porcelain=v1']).out.trim().split(RE_LINES).filter(Boolean) : [];

// ── the sweep's reds, judged against main (2026-09-19, see the header) ──────

/** Spawn without a shell: every argument arrives exactly as written. */
function exec(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeout,
    env: process.env,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error };
}
const firstLine = (s) => (String(s ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '').trim();

/** The verdict on ONE red guard, given what it did here and at the base.
 *
 *    branch  { status }                       the sweep's exit status for it here
 *    base    { evaluable: true,  status }     what the same invocations did at base
 *          | { evaluable: false, reason }     why the base could not answer
 *
 *  REGRESSION     green at base, or red there with a DIFFERENT exit code: this
 *                 branch changed what the guard reports.
 *  ENVIRONMENTAL  red at base with the same exit code: this machine, not this
 *                 branch. Printed, never failed.
 *  COVERAGE-LOST  the base could not answer, or the guard timed out here (a
 *                 timeout is not an exit code, so there is nothing to compare).
 *                 FAILS — an unexplained red is not a pass. */
export function classifyRed(branch, base) {
  if (branch?.status === null || branch?.status === undefined) {
    return { kind: 'COVERAGE-LOST', why: 'it produced no exit code here (timed out or killed), so there is nothing to compare with the base' };
  }
  if (!base || base.evaluable !== true) {
    return { kind: 'COVERAGE-LOST', why: base?.reason ?? 'the base was never evaluated' };
  }
  if (base.status === 0) return { kind: 'REGRESSION', why: 'green at the base, red here' };
  if (base.status !== branch.status) {
    return { kind: 'REGRESSION', why: `red at the base too, but it exits ${base.status} there and ${branch.status} here — this branch changed what it reports` };
  }
  return { kind: 'ENVIRONMENTAL', why: `red at the base too, with the same exit ${base.status} — this machine, not this branch` };
}

/** Output lines a red guard prints here and not at the base, with each tree's
 *  root path normalised away. An ENVIRONMENTAL red can still HIDE a new finding
 *  in the same guard (same exit code, one more problem); this is how that is
 *  made visible without failing on the noise a line diff also carries. */
export function newOutputLines(branchOut, baseOut, branchRoot, baseRoot) {
  const norm = (s, root) => {
    let t = String(s ?? '');
    for (const r of [root, root?.replace(/\\/g, '/'), root?.replace(/\//g, '\\')].filter(Boolean)) t = t.split(r).join('<root>');
    return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  };
  const before = new Set(norm(baseOut, baseRoot));
  return norm(branchOut, branchRoot).filter((l) => !before.has(l));
}

/** Re-run each RED row of a guard-sweep --json document against a clean,
 *  detached checkout of merge-base(HEAD, baseRef), then remove the checkout.
 *
 *  ⚠️ WHERE THE CHECKOUT GOES IS PART OF THE MEASUREMENT. It is placed beside
 *  the other worktrees — `<main checkout>/.worktrees/` via `git rev-parse
 *  --git-common-dir` — and not in the OS temp directory, because guards find
 *  the workspace (the Private corpus, the vault) by walking UP from their own
 *  tree or through the common git dir. From a temp directory the upward walk
 *  finds nothing, the guard is red at the base for THAT reason, and a real
 *  regression is filed as ENVIRONMENTAL: the check would be blind exactly where
 *  it matters. A checkout there has its own `.git` file, so every `listDir`
 *  walk in the branch tree skips it (tree-walk.mjs), and the worktree exists
 *  only after the sweep has finished walking.
 *
 *  Returns { sha, dir, error, seconds, cleanup, results: [{ row, base }] } where
 *  `base` is the shape classifyRed() reads. Never throws. */
export function rerunRedsOnBase(reds, { root = ROOT, baseRef = 'origin/main', timeoutMs = 300_000 } = {}) {
  const started = Date.now();
  const unevaluable = (reason) => reds.map((row) => ({ row, base: { evaluable: false, reason } }));
  const done = (o) => ({ seconds: Math.round((Date.now() - started) / 100) / 10, ...o });
  if (reds.length === 0) return done({ sha: null, dir: null, error: null, cleanup: null, results: [] });

  const mb = exec('git', ['merge-base', 'HEAD', baseRef], { cwd: root });
  const sha = mb.status === 0 ? mb.out.trim().split(/\r?\n/)[0] : '';
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    const error = `\`git merge-base HEAD ${baseRef}\` gave no commit (${firstLine(mb.out) || `exit ${mb.status}`})`;
    return done({ sha: null, dir: null, error, cleanup: null, results: unevaluable(error) });
  }
  const cd = exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root });
  const commonDir = cd.status === 0 ? cd.out.trim().split(/\r?\n/)[0] : '';
  if (!commonDir) {
    const error = `\`git rev-parse --git-common-dir\` failed (${firstLine(cd.out)})`;
    return done({ sha, dir: null, error, cleanup: null, results: unevaluable(error) });
  }
  const dir = join(dirname(resolve(commonDir)), '.worktrees', `pfb-${sha.slice(0, 8)}-${process.pid}`);
  if (existsSync(dir)) {
    const error = `${dir} already exists — a leftover base checkout; remove it (git worktree remove --force) and re-run`;
    return done({ sha, dir, error, cleanup: null, results: unevaluable(error) });
  }
  const add = exec('git', ['worktree', 'add', '--detach', dir, sha], { cwd: root });
  if (add.status !== 0) {
    const error = `\`git worktree add --detach\` of ${sha.slice(0, 8)} failed (${firstLine(add.out)})`;
    return done({ sha, dir: null, error, cleanup: null, results: unevaluable(error) });
  }

  const results = [];
  let cleanup = null;
  try {
    for (const row of reds) {
      const guard = join(dir, 'tooling', 'ci', row.name);
      if (!existsSync(guard)) {
        results.push({ row, base: { evaluable: false, reason: 'the guard does not exist at the base — it is new on this branch, so main cannot vouch for its red' } });
        continue;
      }
      const tried = Array.isArray(row.tried) ? row.tried : [];
      if (tried.length === 0) {
        results.push({ row, base: { evaluable: false, reason: 'the sweep recorded no invocation for it, so there is nothing to repeat' } });
        continue;
      }
      let last = null;
      let passed = false;
      let timedOut = false;
      const absent = [];
      for (const call of tried) {
        // The same test guard-sweep's `blocker` applies: a path-shaped argument
        // must exist, or the guard is red at the base for a missing subject
        // and that red would be filed, wrongly, as ENVIRONMENTAL.
        const missing = (call.args ?? []).map((t) => t.replace(/^["']|["']$/g, ''))
          .filter((t) => t && !t.startsWith('-') && t !== '.' && t.includes('/') && !existsSync(join(dir, t)));
        if (missing.length) { absent.push(...missing); continue; }
        const argv = [...(call.flags ?? []), guard, ...(row.treeScanner ? [dir] : []), ...(call.args ?? [])];
        const r = exec(process.execPath, argv, { cwd: dir, timeout: timeoutMs });
        if (r.status === null) { timedOut = true; continue; }
        last = { status: r.status, out: r.out };
        if (r.status === 0) { passed = true; break; }
      }
      if (passed) results.push({ row, base: { evaluable: true, status: 0, head: firstLine(last.out), out: last.out } });
      else if (last && !timedOut) results.push({ row, base: { evaluable: true, status: last.status, head: firstLine(last.out), out: last.out } });
      else if (timedOut) results.push({ row, base: { evaluable: false, reason: `it timed out at the base (${timeoutMs / 1000}s), so the base gave no verdict` } });
      else results.push({ row, base: { evaluable: false, reason: `every invocation names a subject absent at the base (${[...new Set(absent)].join(', ')})` } });
    }
  } finally {
    const rm = exec('git', ['worktree', 'remove', '--force', dir], { cwd: root });
    if (rm.status !== 0 || existsSync(dir)) {
      cleanup = `could not remove the base checkout ${dir} (${firstLine(rm.out)}) — remove it by hand: git worktree remove --force "${dir}"`;
    }
  }
  return done({ sha, dir, error: null, cleanup, results });
}

/** Leg 2's body: sweep with --json, then judge the reds against the base.
 *  `sweep` is injectable for tests; by default it runs the real sweep. */
export function sweepLeg({ root = ROOT, baseRef = 'origin/main', sweep } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'nikatru-preflight-'));
  const jsonPath = join(tmp, 'sweep.json');
  try {
    const s = sweep ? sweep(jsonPath) : exec(process.execPath, [join(root, 'tooling', 'scripts', 'guard-sweep.mjs'), '--json', jsonPath], { cwd: root });
    let doc = null;
    let why = null;
    try {
      doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
      if (doc?.schema !== 'guard-sweep/1' || !Array.isArray(doc.rows) || doc.rows.length === 0) {
        why = `the sweep's --json output has no rows or an unknown schema (${doc?.schema})`;
      }
    } catch (e) {
      why = `the sweep wrote no readable --json output (${e?.code ?? e?.message ?? e})`;
    }
    if (why) {
      return { code: 1, out: `${s.out}\n🔴 COVERAGE LOST — ${why}. Without per-guard verdicts a RED cannot be told from an environmental one, so this leg refuses rather than reading the exit code alone (the 2026-09-19 defect).` };
    }
    const reds = doc.rows.filter((r) => r.red);
    if (reds.length === 0) return { code: s.status === 0 ? 0 : 1, out: s.out };

    const cmp = rerunRedsOnBase(reds, { root, baseRef });
    const judged = cmp.results.map(({ row, base }) => ({ row, base, ...classifyRed({ status: row.status }, base) }));
    const width = Math.max(...judged.map((j) => j.row.name.length));
    const hereHead = (row) => firstLine(row.out) || row.tried?.[row.tried.length - 1]?.head || '(no output)';
    const lines = [
      '',
      `── the sweep's ${reds.length} RED guard(s), re-run at merge-base ${cmp.sha ? cmp.sha.slice(0, 8) : '(none)'} of HEAD and ${baseRef} — ${cmp.seconds}s ──`,
    ];
    if (cmp.error) lines.push(`🔴 COVERAGE LOST — ${cmp.error}.`);
    for (const j of judged) {
      const name = j.row.name.padEnd(width);
      if (j.kind === 'REGRESSION') {
        lines.push(`✗ REGRESSION     ${name}  ${j.why}. Here, exit ${j.row.status}: ${hereHead(j.row)}`);
      } else if (j.kind === 'ENVIRONMENTAL') {
        lines.push(`⬜ ENVIRONMENTAL ${name}  ${j.why}: ${hereHead(j.row)}`);
        const fresh = newOutputLines(j.row.out, j.base.out, root, cmp.dir);
        if (fresh.length) lines.push(`      ↳ ${fresh.length} output line(s) here that the base does not print — read them, a new finding can hide in an old red: ${fresh[0].slice(0, 200)}`);
      } else {
        lines.push(`🔴 COVERAGE LOST  ${name}  ${j.why}. Here, exit ${j.row.status}: ${hereHead(j.row)}`);
      }
    }
    if (cmp.cleanup) lines.push(`⚠️ ${cmp.cleanup}`);
    const regressions = judged.filter((j) => j.kind === 'REGRESSION').length;
    const lost = judged.filter((j) => j.kind === 'COVERAGE-LOST').length;
    lines.push(`   ${regressions} regression(s) · ${judged.length - regressions - lost} environmental · ${lost} coverage lost. ` +
      'This leg fails on a regression or on a red the base could not explain; an environmental red is main\'s too.');
    const code = s.status !== 0 || regressions > 0 || lost > 0 ? 1 : 0;
    return { code, out: `${s.out}${lines.join('\n')}\n` };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── the untracked files, refused before anything runs (2026-09-19, header) ──

/** Untracked, non-ignored paths under `root`, minus `.worktrees/` (other
 *  checkouts, and not gitignored — see the header). A path ending in `/` is an
 *  embedded git repository: git lists it as one entry and will not descend.
 *  Returns { files } or { error } — never throws, never an empty list for a
 *  git that did not answer. */
export function untrackedFiles({ root = ROOT } = {}) {
  const r = exec('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root });
  if (r.status !== 0 || r.error) {
    return { error: `\`git ls-files --others --exclude-standard\` failed (${firstLine(r.out) || r.error?.code || `exit ${r.status}`})` };
  }
  const files = r.out.split('\0').filter(Boolean).filter((f) => !/^\.worktrees(\/|$)/.test(f)).sort();
  return { files };
}

/** Leg 0's body. Fails on any untracked file, naming each and the fix; fails
 *  as COVERAGE LOST when git could not list them — "I could not look" must
 *  not read as "there were none". */
export function untrackedLeg({ root = ROOT } = {}) {
  const u = untrackedFiles({ root });
  if (u.error) {
    return { code: 1, out: `🔴 COVERAGE LOST — ${u.error}. Without the list, this run cannot tell whether it judges the tree CI will build.` };
  }
  if (u.files.length === 0) return { code: 0, out: 'no untracked, non-ignored file — the index the guards read is the tree' };
  const repos = u.files.filter((f) => f.endsWith('/'));
  const plain = u.files.filter((f) => !f.endsWith('/'));
  const quote = (f) => (/[\s"'$`]/.test(f) ? `"${f}"` : f);
  const lines = [
    `✗ ${u.files.length} untracked file(s). CI builds the COMMITTED tree; the guards and generators that read`,
    '  `git ls-files` (assert-mechanism-claims, gen-start-here --check, …) do not see these here, so a green',
    '  run now is evidence about the last commit, not this one (PR #819, #824, #825 — 2026-09-19):',
    ...u.files.map((f) => `   · ${f}${f.endsWith('/') ? '   (an embedded git repository — do NOT add it; gitignore or move it)' : ''}`),
  ];
  if (plain.length) {
    lines.push('  Fix: make them visible to the index without staging their content, then re-run:');
    lines.push(`     git add -N ${plain.map(quote).join(' ')}`);
    lines.push('  (intent-to-add; `git reset -- <path>` undoes it) — or commit them. A file that must never be');
    lines.push('  committed belongs in .gitignore, not in the tree preflight judges.');
  }
  if (repos.length && !plain.length) lines.push('  Fix: gitignore or move the embedded repository, then re-run.');
  return { code: 1, out: lines.join('\n') };
}

const results = [];
function step(name, why, fn) {
  // Imported for its exports (the test suite), or --sweep-only / --untracked-only
  // for another leg: run nothing. The untracked leg runs under --sweep-only too.
  if (!IS_MAIN) return;
  if (UNTRACKED_ONLY && name !== UNTRACKED_LEG) return;
  if (SWEEP_ONLY && name !== SWEEP_LEG && name !== UNTRACKED_LEG) return;
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

// ── 0 · no untracked files: CI judges the index, so must this run ──────────
// FIRST, and it STOPS the run on failure — see the header's second 2026-09-19
// block. Every later leg would report on a tree CI never builds.
step(
  UNTRACKED_LEG,
  'CI commits the tree and the index-reading guards (assert-mechanism-claims, gen-start-here --check) count only what `git ls-files` lists. Untracked here means unseen here and seen in CI: PR #819, #824 and #825 went red in CI after a green preflight on 2026-09-19.',
  () => untrackedLeg(),
);
if (IS_MAIN && results.length && results[results.length - 1].code !== 0) {
  const f = results[results.length - 1];
  console.log('\n' + '─'.repeat(78));
  console.log(`\nFAIL  ${f.name}`);
  console.log(`      WHY THIS LEG EXISTS: ${f.why}`);
  console.log(f.out.split(/\r?\n/).map((l) => `      ${l}`).join('\n'));
  console.log('\npreflight: STOPPED at the first leg — no other leg ran, because each would judge a tree CI does not have. Fix the above and re-run.');
  process.exit(1);
}

// ── the machine: one heavy run at a time, and the backup first (header) ─────
// After the cheap untracked leg, before the first heavy one. Imported lazily so
// --untracked-only and an import for the exports never load it.
/** Free the machine-wide lock the moment the WORK is over.
 *
 * 🔴 `releaseOnExit` ALONE IS NOT ENOUGH, AND THAT COST HOURS ON 2026-09-20.
 * It hangs the release off `process.on('exit')`, so the lock comes back only
 * when node actually exits — and node does not always get there. A heavy run
 * that has printed its verdict can hang at exit (nodejs#54918, already recorded
 * against the guards in TRAPS), and then the lock is held by a process doing
 * NOTHING until the 240-minute stale ceiling reclaims it.
 *
 * Measured three times that day: pid 19820 for ~2 h on 0.84 s of CPU, pid 24176
 * for 85.8 min with both its children already exited and its CPU flat across a
 * 25-second sample, pid 21644 the same. `pidAlive` cannot see it — a hung
 * process is alive — so the liveness test passes forever and three preflights
 * plus a capture rehearsal queue behind a run that has finished.
 *
 * So the release is called HERE, explicitly, after the last leg and before the
 * verdict is even printed. `releaseHeavyLock` is idempotent (`lock.released`),
 * so the exit handler still fires and still does the right thing; this just
 * stops the lock depending on an exit that may never come.
 */
let releaseWorkLock = () => {};

if (IS_MAIN && !UNTRACKED_ONLY) {
  const { machineFree, releaseOnExit, releaseHeavyLock } = await import('./heavy-lock.mjs');
  const free = machineFree({
    ...(LOCK_WAIT_MIN === undefined ? {} : { waitMin: LOCK_WAIT_MIN }),
    argv: ['preflight.mjs', ...process.argv.slice(2)],
  });
  if (!free.ok) {
    console.log(`\n${free.message}`);
    console.log('preflight: STOPPED before the first heavy leg — exit 2, COVERAGE LOST: nothing was judged.');
    process.exit(2);
  }
  releaseOnExit(free.lock, (code) => process.exit(code));
  releaseWorkLock = () => releaseHeavyLock(free.lock);
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
// Its exit code says nothing about greenness, so this leg also judges every RED
// the sweep reports against merge-base(HEAD, origin/main) — see the header's
// 2026-09-19 block and `sweepLeg`. Until then a red here was never a failure.
step(
  SWEEP_LEG,
  'assert-app-dod and assert-sworn-store-files both failed CI while never being run locally. The sweep is what reaches them without a hand-kept list; and a guard the BRANCH turned red (PR #818, assert-walks-bounded, 2026-09-19) fails here, while one that is red on main too is only printed.',
  () => sweepLeg({ baseRef: BASE_REF }),
);

// ── 3 · format drift, PRINTED, NEVER FAILED ─────────────────────────────────
// 🔴 THIS LEG WAS A HARD FAILURE FOR ONE REVISION AND THAT WAS WRONG. It format-
// checked every tracked .dart file — but ci.yml checks exactly TWO paths,
// `apps/probe` and `apps/probeapi`, both STAMPED apps — the `app_brick` job's
// `Stamped app is dart format-clean` and `Stamped backend app is dart format-clean`
// steps. CITED BY STEP NAME, and the reason is sitting in this file's own history:
// the two `ci.yml:NNNN` numbers that stood here had ALREADY drifted off their
// steps before anyone noticed — :1983 onto the `SHOW-1` step and :2095 onto a bare
// comment — because nothing recomputes a line number when someone inserts above
// it, and no guard resolves a public→public path citation. A step name moves with
// the step. The
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
      // 🔴 THE PIN IS IN tooling/versions.json, AND READING IT FROM ci.yml MADE
      // THIS WHOLE PROTECTION DEAD. Until 2026-09-12 this parsed
      // `flutter-version:\s*([0-9.]+)` out of ci.yml. That key is not in ci.yml
      // any more — it moved into .github/actions/setup-flutter/action.yml, where
      // it is not even a literal (`flutter-version: ${{ steps.pin.outputs.flutter }}`,
      // resolved by a step that reads tooling/versions.json). So `ciPin` was
      // null, `skewed` was ALWAYS false, and the downgrade below could never
      // fire: every format disagreement hard-failed, which is the cry-wolf this
      // leg's own comment says it exists to avoid. MEASURED on merged main
      // (81e43918): pin 3.47.2, local 3.44.9 — skewed, and reported as a hard
      // failure anyway while CI's brick job was green on the same commit.
      //
      // ⚠️ AND A NULL PIN IS NOW LOUD RATHER THAN SILENT. That is the actual
      // repair: "I cannot tell whether this machine agrees with CI" must not
      // look like "this machine disagrees with CI". The same shape took
      // guard-sweep.mjs's invocation matcher out of service on 2026-09-11 when
      // `--single-threaded` was added to the lines it parses — a local script
      // reading a moved workflow detail, failing closed into nonsense.
      const PIN_FILE = 'tooling/versions.json';
      let ciPin = null;
      let pinError = null;
      try {
        const pinned = JSON.parse(readFileSync(resolve(ROOT, PIN_FILE), 'utf8')).flutter;
        if (typeof pinned === 'string' && pinned.trim()) ciPin = pinned.trim();
        else pinError = `${PIN_FILE} carries no usable \`flutter\` version`;
      } catch (e) {
        pinError = `${PIN_FILE} could not be read (${e?.code ?? e?.message ?? e})`;
      }
      const localVer = (run('flutter', ['--version']).out.match(/Flutter\s+([0-9.]+)/) || [])[1] ?? null;
      const skewed = ciPin && localVer && ciPin !== localVer;
      const fmt = run('dart', ['format', '--output=none', '--set-exit-if-changed', 'apps/probe']);
      const dod = run('node', ['tooling/ci/assert-app-dod.mjs']);
      // The pin could not be resolved, so the skew question was never answered.
      // Say THAT, instead of presenting a formatting diff as the finding — a leg
      // that blames the tree for its own blindness is how this one spent a month
      // hard-failing on a green commit.
      if (fmt.code !== 0 && pinError) {
        fmt.out =
          `🔴 COVERAGE LOST on the skew check — ${pinError}, so this leg cannot tell whether ` +
          `local Flutter ${localVer ?? '(unknown)'} is CI's. The formatting diff below is NOT the finding; ` +
          `the unresolvable pin is. Fix the pin lookup (CI reads it via .github/actions/setup-flutter) ` +
          `before reading anything into these files.\n${fmt.out.split(/\r?\n/).slice(-3).join('\n')}`;
        return { code: 1, out: fmt.out };
      }
      if (fmt.code !== 0 && skewed) {
        // Report it, do not fail on it — and say WHY, so nobody "fixes" the
        // formatting to satisfy a toolchain CI does not use.
        fmt.code = 0;
        // The FILE is named, not just the version. This line said "the ci.yml
        // pin" while the pin had moved to tooling/versions.json — the same stale
        // pointer that killed the check above, left in the message that explains
        // it, which would send the next reader to a file with no pin in it.
        fmt.out = `⬜ dart format disagrees on the stamped app, but local Flutter ${localVer} != the ${PIN_FILE} pin ${ciPin} (CI reads it via .github/actions/setup-flutter), so this machine's dart_style is not CI's. NOT failed. To make this leg trustworthy, match the pin: flutter version ${ciPin}.\n${fmt.out.split(/\r?\n/).slice(-3).join('\n')}`;
      }
      // 🔴 THE STAMP MUTATES TRACKED FILES — pubspec.yaml gains apps/probe as a
      // workspace member, and the stamp writes apps/probe/app.yaml and RENDERS
      // catalog/apps.json from every declaration in the tree. Left behind, a
      // later `git add -A` commits the throwaway probe's registration.
      //
      // 🔴 `catalog/apps.json` WAS MISSING FROM THIS LIST AND THAT IS TRAPS ci-30
      // IN FULL: the stamp wrote the catalogue, this leg did not put it back, and
      // leg 6 below — "the checks did not edit the tree behind you" — then
      // reported the file THIS SCRIPT had just changed. A preflight that fails
      // its own last leg for its own edit is read as a broken tree, and the two
      // "failures" get dismissed together. `sites/_shared/_data/apps.json` is
      // kept beside it: it is generated FROM the catalogue, and it was on this
      // list while its own source was not.
      run('git', ['checkout', '--', 'pubspec.yaml', 'catalog/apps.json', 'sites/_shared/_data/apps.json']);
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
  'assert-guard-coverage rewrites coverage-manifest.json and the stamp edits pubspec.yaml, the catalogue and the site feed. Anything a CHECK wrote must be seen and committed deliberately, not carried along unnoticed.',
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
if (IS_MAIN) {
  // ⚠️ BEFORE THE VERDICT IS PRINTED, not after. Every leg has run, so the
  // machine is free whatever happens next — including this process hanging at
  // exit, which is what kept the lock for 85 minutes on 2026-09-20 while three
  // other lanes waited. Printing is not work, and no other lane should queue
  // behind it.
  releaseWorkLock();

  const failed = results.filter((r) => r.code !== 0);
  console.log('\n' + '─'.repeat(78));
  if (failed.length === 0) {
    // --sweep-only proved one leg; it must not borrow the whole run's sentence.
    console.log(UNTRACKED_ONLY
      ? 'preflight --untracked-only: ok — no untracked file. The other legs did not run; this is not "CI should agree".'
      : SWEEP_ONLY
      ? 'preflight --sweep-only: ok — the untracked-files and guard-sweep legs are green. The other legs did not run; this is not "CI should agree".'
      : `preflight: ok — ${results.length} leg(s) green${FAST ? ' (--fast: stamped-app leg skipped)' : ''}. CI should agree.`);
    process.exit(0);
  }
  for (const f of failed) {
    console.log(`\nFAIL  ${f.name}`);
    console.log(`      WHY THIS LEG EXISTS: ${f.why}`);
    console.log(f.out.split(/\r?\n/).slice(-40).map((l) => `      ${l}`).join('\n'));
  }
  console.log(`\npreflight: ${failed.length} of ${results.length} leg(s) FAILED — this is what CI would have told you in six minutes.`);
  process.exit(1);
}
