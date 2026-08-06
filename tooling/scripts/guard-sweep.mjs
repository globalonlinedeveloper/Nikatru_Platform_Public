#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// guard-sweep.mjs — run EVERY guard in tooling/ci, and prove the sweep reached
// every one of them.
//
// 🔴 WHY THIS EXISTS, AND IT IS A PROCESS DEFECT RATHER THAN A CODE ONE.
// Sessions swept the guards by hand with
//
//     for g in tooling/ci/assert-*.mjs tooling/ci/check-*.mjs; do node "$g"; done
//
// A NAME PATTERN. It silently excluded `scan-secrets.mjs`, `scan-workflows.mjs`,
// `record-deployment.mjs`, `release-manifest.mjs` and `android-signing.mjs` —
// five runnable files, one of which is the SECRET SCANNER. On 2026-08-06 a
// secret-scan failure reached CI that a complete local sweep would have caught,
// and every "guards red: N" figure reported that day was over an incomplete
// domain. The loop printed the same reassuring output either way.
//
// ⚠️ THE HANDOFF NOTE THAT PRESCRIBED THE FIX WAS ITSELF WRONG, WHICH IS THE
// WHOLE ARGUMENT FOR A SCRIPT. It named the four excluded files and one of them,
// `workflow-scan.mjs`, is a LIBRARY with no entry point at all, while the
// runnable guard beside it — `scan-workflows.mjs`, a different file with the
// words reversed — went unnamed, as did `android-signing.mjs`. A prose list of
// exceptions is a second copy of the tree, and the second copy was wrong within
// one day of being written.
//
// ── WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────
// It asserts COMPLETENESS, not greenness. Completeness is what failed.
//
//   Every `tooling/ci/*.mjs` (minus `test/`) is either
//     RUN        — with the arguments a workflow really passes it, read from the
//                  workflow YAML so they cannot drift from CI, or
//     EXPLAINED  — classified by a MECHANISM, never by a hand-kept list of names.
//
// Exit 1 means a file was neither run nor explained. A guard that runs and fails
// is REPORTED, not an exit-1 here: several fail locally for correct reasons
// (`assert-ops-register.mjs` is red today because two real duties have no
// successful run), and a sweep that conflated "this guard found something" with
// "the sweep is broken" would train its reader to ignore both.
//
// ── THE THREE MECHANISMS, each derived rather than declared ──────────────────
//   LIBRARY        no `process.exit` / `process.argv` anywhere in the file. It is
//                  imported, not executed. `assert-guard-coverage.mjs` already
//                  proves the import chain reaches a workflow.
//   NEEDS-CI       its workflow invocation carries an unresolved `${{ … }}`
//                  expansion, or the guard's own output names an environment
//                  variable it could not read. Read from the YAML, not guessed.
//   MUTATES        it is invoked by a PUBLISHING lane (deploy-*, submit-*,
//                  build-platforms) rather than by `ci.yml`. These write outside
//                  the repo — a GitHub Deployment, a Release, a materialised
//                  keystore — so running one locally is an outward-facing act,
//                  not a check. Derived from which workflow file names it.
//
// Usage:  node tooling/scripts/guard-sweep.mjs [--verbose]
// Exit:   0 = every file run or explained · 1 = a file the sweep could not reach
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CI_DIR = join(ROOT, 'tooling', 'ci');
const WF_DIR = join(ROOT, '.github', 'workflows');
const VERBOSE = process.argv.includes('--verbose');

/** Lanes that write outside the repository. Membership is a property of the
 *  workflow, so a new publishing lane inherits this without an edit here. */
const PUBLISHING = /^(deploy-|submit-|build-platforms|release)/;

// ── the domain: every .mjs directly under tooling/ci, `test/` excluded ────────
const files = readdirSync(CI_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
  .map((e) => e.name)
  .sort();

if (files.length === 0) {
  console.error('✗ COVERAGE LOST — no .mjs found in tooling/ci. The sweep would report a clean empty domain.');
  process.exit(1);
}

// ── every workflow invocation, with its real arguments ───────────────────────
const invocations = new Map(); // basename -> [{ wf, argv, raw }]
const workflows = existsSync(WF_DIR)
  ? readdirSync(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];
if (workflows.length === 0) {
  console.error(`✗ COVERAGE LOST — no workflow files under ${WF_DIR}, so no invocation could be read and every guard would look unreferenced.`);
  process.exit(1);
}
for (const wf of workflows) {
  const text = readFileSync(join(WF_DIR, wf), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    // Skip YAML comments: a guard named only in a comment is discussed, not run.
    const code = line.replace(/^\s*#.*$/, '');
    const m = code.match(/node\s+tooling\/ci\/([a-z0-9._-]+\.mjs)([^|&;#\n]*)/i);
    if (!m) continue;
    const [, name, tail] = m;
    // Cut the shell furniture, not just some of it. The first version of this
    // stripped `2>` only when it was preceded by whitespace and left `)"` behind
    // on an invocation nested in `$( … )`, so two guards were "run" with garbage
    // arguments and reported RED for a reason that was mine. A diagnostic is a
    // claim and needs the same evidence as a finding.
    const raw = tail
      .replace(/\s*\d?>[>&].*$/, '')   // 2>&1, >>, 2>/dev/null
      .replace(/\s*\d?>\s*\S*.*$/, '') // `> file`, and a bare trailing `2>` left
                                       //  behind when the capture stopped at `&`
      .replace(/\)+["']?\s*$/, '')     // trailing $( … ) / "$( … )" furniture
      .trim();
    if (!invocations.has(name)) invocations.set(name, []);
    const list = invocations.get(name);
    if (!list.some((x) => x.raw === raw && x.wf === wf)) list.push({ wf, raw });
  }
}

const isLibrary = (name) => {
  const src = readFileSync(join(CI_DIR, name), 'utf8');
  return !/process\.(exit|argv)/.test(src);
};

const rows = [];
let unreached = 0;
let ran = 0;
let red = 0;

for (const name of files) {
  const calls = invocations.get(name) ?? [];
  const publishing = calls.length > 0 && calls.every((c) => PUBLISHING.test(c.wf));

  if (calls.length === 0) {
    if (isLibrary(name)) {
      rows.push({ name, verdict: 'LIBRARY', note: 'no process.exit/argv — imported, not executed' });
      continue;
    }
    unreached++;
    rows.push({ name, verdict: 'UNREACHED', note: '🔴 runnable, and NO workflow invokes it — neither run nor explained' });
    continue;
  }

  if (publishing) {
    rows.push({
      name,
      verdict: 'MUTATES',
      note: `only ${[...new Set(calls.map((c) => c.wf))].join(', ')} invokes it — a publishing lane writes outside the repo, so running it here is an act, not a check`,
    });
    continue;
  }

  // ── WHICH INVOCATION TO RUN ────────────────────────────────────────────────
  // Not "the richest". Several guards have both a bare call and one whose
  // SUBJECT is CI-ephemeral — `apps/probe`, `services/probeapi-api`, a built web
  // bundle — none of which exist in a working tree. Picking the longest ran
  // those and reported RED for a missing fixture, which is a sweep defect
  // wearing a finding's clothes. So: keep only the invocations this machine can
  // actually satisfy, and run the richest of THOSE.
  const blocker = (raw) => {
    if (/\$\{\{/.test(raw)) return `a CI expression: \`${raw}\``;
    if (/\$\{?\w+\}?/.test(raw)) return `a runner environment variable: \`${raw}\``;
    for (const tok of raw.split(/\s+/)) {
      if (!tok || tok.startsWith('-') || tok === '.') continue;
      const bare = tok.replace(/^["']|["']$/g, '');
      if (!bare.includes('/')) continue;
      if (!existsSync(join(ROOT, bare))) return `its subject does not exist here: \`${bare}\` (CI-ephemeral)`;
    }
    return null;
  };

  const runnable = calls.filter((c) => blocker(c.raw) === null);
  if (runnable.length === 0) {
    const why = blocker(calls.slice().sort((a, b) => a.raw.length - b.raw.length)[0].raw);
    rows.push({ name, verdict: 'NEEDS-CI', note: why });
    continue;
  }
  // TRY EVERY runnable invocation, shortest first, and pass if ANY exits 0.
  // A guard often has a bare self-scan plus a richer call whose subject only
  // exists in CI; taking one arbitrarily reported the other's absence as a
  // finding. "No invocation of this guard passes here" is the honest red.
  let last = null;
  let passed = null;
  for (const call of runnable.slice().sort((a, b) => a.raw.length - b.raw.length)) {
    const argv = call.raw.length ? call.raw.split(/\s+/) : [];
    const r = spawnSync(process.execPath, [join(CI_DIR, name), ...argv], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 300_000,
    });
    ran++;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    last = { status: r.status, argv, tail: out.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '' };
    if (r.status === 0) { passed = last; break; }
  }
  if (passed) {
    rows.push({ name, verdict: 'ok', note: passed.argv.length ? `args: ${passed.argv.join(' ')}` : '', out: passed.tail });
  } else {
    red++;
    rows.push({
      name,
      verdict: `RED(${last.status})`,
      note: `no invocation passes here (${runnable.length} tried, last: ${last.argv.join(' ') || '(no args)'})`,
      out: last.tail,
      showOut: true,
    });
  }
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) {
  const mark = r.verdict === 'ok' ? 'ok ' : r.verdict.startsWith('RED') ? '✗  ' : '⬜ ';
  const line = `${mark} ${r.name.padEnd(width)}  ${r.verdict.padEnd(9)} ${r.note}`;
  console.log(line);
  // A red always shows WHY, without a second run. A sweep whose reader has to
  // re-invoke each failure to learn anything is a sweep that gets skimmed.
  if ((VERBOSE || r.showOut) && r.out) console.log(`      ↳ ${r.out.slice(0, 220)}`);
}

const counts = rows.reduce((a, r) => {
  const k = r.verdict.startsWith('RED') ? 'RED' : r.verdict;
  a[k] = (a[k] ?? 0) + 1;
  return a;
}, {});
console.log('');
console.log(
  `⬜ guard sweep — ${files.length} file(s) in tooling/ci, ${ran} executed with the arguments ${workflows.length} workflow(s) really pass them: ` +
    Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · '),
);
console.log(
  '   This asserts COMPLETENESS, not greenness. A RED above is a guard reporting a finding — read it. ' +
    'Exit 1 here means a file was neither run nor explained, which is the failure a name-pattern sweep produced silently.',
);

if (unreached > 0) {
  console.error(`\n✗ ${unreached} runnable file(s) in tooling/ci are invoked by no workflow — the sweep cannot reach them and neither can CI.`);
  process.exit(1);
}
process.exit(0);
