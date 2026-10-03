#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// rehearse-app2.mjs — stamp a throwaway app #2 from the brick, run every lane
// in its dry-run mode, and MEASURE how long a second app takes to ship.
// [lane app2-dryrun] Row: O-TIME-TO-SHIP-UNMEASURED.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// The business is a portfolio of apps, so the second app's cost is the margin
// lever, and nothing measured it: 28 open register rows name "app #2", the kit
// stamps one in CI (ci.yml's probe) and every lane has a dry-run mode, but no
// run ever walked the whole path for ONE new id, timed it, and named the steps
// a human still does. This does, and writes one JSON a later run is compared to
// (tooling/kit/rehearsal-trend.mjs).
//
// ── WHAT IT DOES ────────────────────────────────────────────────────────────
//   1. A TEMPORARY WORK TREE: `git worktree add --detach <tmp> HEAD`. Nothing is
//      stamped into the checkout this runs from, and the tree is removed at the
//      end (`--keep` leaves it, for a reader). Its pubspec.lock is its own, so a
//      `flutter` command inside it rewrites nothing real (trap git-09).
//   2. THE STEPS, from tooling/kit/rehearsal-steps.json, in order. An `auto`
//      step runs its argv(s) with `{id}`, `{vars}` and `{tree}` substituted, and
//      is timed. A `manual` step is a human, a console, a credential or a hand
//      edit, and is recorded with the register row that owns it. An auto step
//      that declares `handEdits` (a file a human must edit for it to pass) and
//      exits 1 with its declared `handEditFinding` is a manual step, not a
//      failure: the kit should own that file, and that finding is the evidence
//      a person still edits it. An exit 2, a crash or any other finding is a
//      FAILURE. Passing untouched, it is automatic — and the trend says so. A
//      step may instead declare the one `refusal` it is expected to meet for a
//      new app (`match`, its wrapper lines `context`, and the `row` or `gate`
//      that owns it): web-prove-first ([pipeline 10]D-6) refuses every store
//      submission of a `preview` app, by design. Only an output whose EVERY
//      problem line is that refusal is gated/manual (onlyTheRefusal); any other
//      problem beside it is a failure.
//   3. THE KIT'S OWN READOUT, after the stamp: `new-product.mjs plan <id>` lists
//      every step still OWNER, NEXT or UNREAD for the new id. Each becomes a
//      manual step, mapped to a row through `readoutRows`.
//   4. ONE JSON: per step {name, seconds, result, manual, why, row, targets},
//      the totals, and the estimated time-to-ship as a {value, asOf, verify}
//      fact. Nothing is deployed, published or created anywhere: every lane is
//      run in its dry-run mode, and no step reads a secret.
//
// ── EXIT ────────────────────────────────────────────────────────────────────
//   0  every auto step passed and every manual step names its row
//   1  a step FAILED (reported as that step's failure, never as an overall
//      pass), or a manual step names no row — an unmapped manual step is a finding
//   2  COVERAGE LOST: a step was skipped (its tool is not on PATH), the steps
//      file is unreadable, or the work tree could not be made. A skipped step
//      is not a pass, so a run that skipped one is not evidence of anything.
//
// Usage:
//   node tooling/kit/rehearse-app2.mjs [--out <file.json>] [--id <app id>] [--only <name;…>] [--keep]
//   (default id: rehearsal<yyyymmdd>; `-` is not valid in an app id)
// Tests: tooling/ci/test/rehearse-app2.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STEPS_FILE = 'tooling/kit/rehearsal-steps.json';
const ME = 'tooling/kit/rehearse-app2.mjs';

export function loadSteps(root = ROOT) {
  return JSON.parse(readFileSync(join(root, STEPS_FILE), 'utf8'));
}

/** True when `name` resolves on PATH (with PATHEXT on Windows). */
export function onPath(name, env = process.env) {
  const exts = process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())] : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const e of exts) if (existsSync(join(dir, `${name}${e}`))) return true;
  }
  return false;
}

const subst = (s, ctx) => String(s).replace(/\{(id|vars|tree)\}/g, (_, k) => ctx[k]);

/** The default runner: spawns without a shell, inherits nothing secret (see below). */
export function spawnRun(argv, { cwd, env }) {
  const win = process.platform === 'win32' && !argv[0].endsWith('.exe') && argv[0] !== 'node';
  const r = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', shell: win, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

/** The environment a step runs in: PATH and the toolchain, never a credential. */
export function stepEnv(env = process.env) {
  const keep = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'ComSpec', 'PUB_CACHE', 'FLUTTER_ROOT', 'NIKATRU_FLUTTER_ROOT', 'CI', 'LANG'];
  return Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
}

/**
 * Run the declared steps. `run(argv, {cwd, env})` -> {status, out}; `has(tool)` -> bool;
 * `clock()` -> ms. Returns one result per step, in order.
 */
export function runSteps(steps, { tree, id, vars, run = spawnRun, has = onPath, clock = Date.now, env = stepEnv() }) {
  const ctx = { id, vars, tree };
  const results = [];
  for (const s of steps) {
    const base = { name: s.name, targets: s.targets ?? [], row: s.row ?? null };
    const handEdits = Array.isArray(s.handEdits) ? s.handEdits.map((f) => subst(f, ctx)) : [];
    if (s.kind === 'manual') {
      results.push({ ...base, seconds: 0, result: 'manual', manual: true, why: s.why ?? null, estimateMinutes: s.estimateMinutes ?? null });
      continue;
    }
    const missing = (s.needs ?? []).filter((t) => !has(t));
    if (missing.length) {
      results.push({ ...base, seconds: 0, result: 'skip', manual: false, why: `not on PATH: ${missing.join(', ')}` });
      continue;
    }
    const t0 = clock();
    let result = 'pass';
    let tail = '';
    let full = '';
    let status = 0;
    for (const argv of s.argvs ?? [s.argv]) {
      const r = run(argv.map((a) => subst(a, ctx)), { cwd: join(tree, subst(s.cwd ?? '.', ctx)), env: { ...env, ...(s.env ?? {}) } });
      full = r.out;
      tail = r.out.trim().split('\n').slice(-3).join(' ⏎ ');
      if (r.status !== 0) {
        result = 'fail';
        status = r.status;
        // The refusal's own first line, then the tail: a summary line alone does not say what refused.
        const first = r.out.split('\n').find((l) => /✗|FAIL|refus|COVERAGE LOST/i.test(l));
        tail = `exit ${r.status}: ${first ? `${first.trim().slice(0, 400)} … ` : ''}${tail}`;
        break;
      }
    }
    const seconds = Math.round((clock() - t0) / 100) / 10;
    if (result === 'fail' && s.refusal && onlyTheRefusal(full, s.refusal)) {
      // The ONE refusal this step is expected to meet for a new app — a deliberate gate (`gate`, the
      // requirement that makes it one) or a step a person still does (`row`) — and NOTHING ELSE: every
      // other problem line in the same output makes the step a failure (review of #1189, finding 6).
      results.push({ ...base, row: s.refusal.row ?? null, gate: s.refusal.gate ?? null, seconds, result: s.refusal.gate ? 'gated' : 'manual', manual: true, why: `${s.refusal.why} The check said: ${tail}`, estimateMinutes: s.refusal.estimateMinutes ?? s.estimateMinutes ?? null, out: tail });
    } else if (handEdits.length && result === 'fail' && status === 1 && typeof s.handEditFinding === 'string' && new RegExp(s.handEditFinding).test(full)) {
      // A step whose check fails until a person edits a file the kit should own IS a manual step: the
      // failure is the evidence. ONLY its own finding (exit 1, the declared words): an exit 2 (COVERAGE
      // LOST), a crash or any other finding is a failure, so a check that stopped checking cannot hide
      // as a manual step (review of #1189, finding 5). Passing untouched, the step has become automatic
      // (rehearsal-trend.mjs prints it as NEWLY AUTOMATED).
      results.push({ ...base, seconds, result: 'manual', manual: true, why: `needs a hand edit of ${handEdits.join(', ')}, which the kit should own. ${s.why ?? ''} The check said: ${tail}`.trim(), estimateMinutes: s.estimateMinutes ?? null, out: tail });
    } else {
      results.push({ ...base, seconds, result, manual: false, why: result === 'fail' ? tail : (s.why ?? null), out: tail, ...(s.readout === true ? { readout: full } : {}) });
    }
  }
  return results;
}

/** True when `out` carries the refusal's words and no OTHER problem: every `✗`/`FAIL` line is the
 *  refusal itself or its declared `context` (the wrapper and header lines the tool prints around it),
 *  and every "N problem(s)" count is at most 1. */
export function onlyTheRefusal(out, refusal) {
  const match = new RegExp(refusal.match);
  if (!match.test(out)) return false;
  const context = refusal.context ? new RegExp(refusal.context) : null;
  const others = String(out)
    .split('\n')
    .filter((l) => /^\s*(?:✗|FAIL\b)/.test(l) && !match.test(l) && !(context && context.test(l)));
  const counts = [...String(out).matchAll(/(\d+) problem\(s\)/g)].map((m) => Number(m[1]));
  return others.length === 0 && counts.every((n) => n <= 1);
}

/** The kit's readout lines `OWNER|NEXT|UNREAD <step> — <why>` as steps: manual, mapped through `rows`,
 *  unless `lanes` names the scheduled workflow that already does it for every declared app. A `LOST`
 *  line is the KIT losing coverage, not a person's step: it is a skip, which the run reports as exit 2. */
export function readoutSteps(text, rows = {}, estimates = {}, lanes = {}) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^(OWNER|NEXT|UNREAD|LOST) (.+?) — (.*)$/);
    if (!m) continue;
    const name = m[2].trim();
    const said = `${m[1]} in new-product.mjs plan — ${m[3].trim()}`;
    if (m[1] === 'LOST') {
      out.push({ name: `readout: ${name}`, targets: [], seconds: 0, result: 'skip', manual: false, row: null, why: `the kit's readout lost coverage: ${said}` });
      continue;
    }
    if (typeof lanes[name] === 'string') {
      out.push({ name: `readout: ${name}`, targets: [], seconds: 0, result: 'lane', manual: false, row: null, why: `done by ${lanes[name]} on its own schedule, for every declared app; ${said}` });
      continue;
    }
    out.push({ name: `readout: ${name}`, targets: [], seconds: 0, result: 'manual', manual: true, why: said, row: rows[name] ?? null, estimateMinutes: estimates[name] ?? null });
  }
  return out;
}

/** Totals and the time-to-ship fact. */
export function summarize(results, { asOf, id, defaultManualMinutes = 60 }) {
  const failed = results.filter((r) => r.result === 'fail');
  const skipped = results.filter((r) => r.result === 'skip');
  const manual = results.filter((r) => r.manual);
  // Owned by a register row, or by the requirement that makes it a deliberate gate; anything else is a finding.
  const unmapped = manual.filter((r) => !(typeof r.row === 'string' && /^O-[A-Z0-9-]+$/.test(r.row)) && !(typeof r.gate === 'string' && r.gate.trim() !== ''));
  const automatedSeconds = results.filter((r) => !r.manual).reduce((n, r) => n + (r.seconds ?? 0), 0);
  const manualMinutes = manual.reduce((n, r) => n + (Number.isFinite(r.estimateMinutes) ? r.estimateMinutes : defaultManualMinutes), 0);
  const hours = Math.round(((automatedSeconds / 60 + manualMinutes) / 60) * 10) / 10;
  return {
    automatedMinutes: Math.round((automatedSeconds / 60) * 10) / 10,
    manualSteps: manual.length,
    unmappedManualSteps: unmapped.map((r) => r.name),
    failedSteps: failed.map((r) => r.name),
    skippedSteps: skipped.map((r) => r.name),
    timeToShip: {
      value: hours,
      unit: 'hours',
      asOf,
      basis: `automated minutes MEASURED by this run plus each manual step's declared estimate (${defaultManualMinutes} min where a step declares none); an estimate, not a measurement, for the manual part`,
      verify: `node ${ME} --id ${id} --out rehearsal.json`,
    },
  };
}

export function exitCode(summary) {
  if (summary.failedSteps.length || summary.unmappedManualSteps.length) return 1;
  if (summary.skippedSteps.length) return 2;
  return 0;
}

/** The rehearsal's workflow, held to its promise: scheduled and dispatchable, no secret, no write.
 *  Returns the problems with `text` (the workflow file's bytes). */
export const WORKFLOW = '.github/workflows/rehearse-app2.yml';
export function workflowProblems(text) {
  const problems = [];
  const body = String(text)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  if (/\$\{\{\s*secrets\./.test(body)) problems.push(`${WORKFLOW} reads a secret (\${{ secrets.… }}); the rehearsal runs every lane dry and needs none.`);
  if (/\bsecrets\s*:\s*inherit\b/.test(body)) problems.push(`${WORKFLOW} inherits secrets.`);
  if (/\$\{\{\s*github\.token\s*\}\}/.test(body)) problems.push(`${WORKFLOW} hands the job token to a step; nothing here writes anywhere.`);
  for (const m of body.matchAll(/^\s*([a-z-]+)\s*:\s*write\b/gm)) problems.push(`${WORKFLOW} grants \`${m[1]}: write\`; the job reads the tree and writes nothing.`);
  if (/permissions\s*:\s*write-all/.test(body)) problems.push(`${WORKFLOW} grants write-all.`);
  if (!/^\s*permissions\s*:\s*\{\s*\}\s*$/m.test(body)) problems.push(`${WORKFLOW} does not set top-level \`permissions: {}\`.`);
  if (!/^\s*schedule\s*:/m.test(body)) problems.push(`${WORKFLOW} has no \`schedule\`: a rehearsal nobody schedules is a snapshot, not a trend.`);
  if (!/^\s*workflow_dispatch\s*:/m.test(body)) problems.push(`${WORKFLOW} has no \`workflow_dispatch\`.`);
  if (!body.includes(`node ${ME}`)) problems.push(`${WORKFLOW} does not run ${ME}.`);
  return problems;
}

/** The vars the throwaway app is stamped with: the brick's backend probe vars, under the new id. */
export function rehearsalVars(root, id) {
  const v = JSON.parse(readFileSync(join(root, 'tooling/bricks/app/_probe_backend_vars.json'), 'utf8'));
  return { ...v, app_id: id, display_name: `Rehearsal ${id}`, icon_label: 'Rehearsal', pages_origin: `${id}-fixture.pages.dev`, description: 'A throwaway app #2, stamped weekly to measure time-to-ship.', subtitle: 'Rehearsal app' };
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const today = new Date().toISOString().slice(0, 10);
  const id = opt('--id') ?? `rehearsal${today.replace(/-/g, '')}`;
  const out = opt('--out');
  const only = opt('--only') ? new Set(opt('--only').split(';').map((s) => s.trim())) : null;
  let decl;
  try {
    decl = loadSteps();
  } catch (e) {
    console.error(`rehearse-app2: COVERAGE LOST — ${STEPS_FILE} is unreadable (${e.message}).`);
    process.exit(2);
  }
  // The LONG path: a Windows 8.3 name (LOCALU~2) is refused by stamp-app.mjs's argument allow-list.
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'nk-rehearsal-')));
  const tree = join(base, 'tree');
  const wt = git(['worktree', 'add', '--detach', tree, 'HEAD'], ROOT);
  if (wt.status !== 0) {
    console.error(`rehearse-app2: COVERAGE LOST — the temporary work tree could not be made: ${wt.out.trim()}`);
    process.exit(2);
  }
  // Inside the tree, under the gitignored build/, and passed RELATIVE: the stamp runs from the tree's root.
  const vars = 'build/rehearsal-vars.json';
  mkdirSync(join(tree, 'build'), { recursive: true });
  writeFileSync(join(tree, vars), `${JSON.stringify(rehearsalVars(ROOT, id), null, 2)}\n`);
  const t0 = Date.now();
  let results;
  try {
    const steps = decl.steps.filter((s) => !only || only.has(s.name));
    results = runSteps(steps, { tree, id, vars });
    // The kit's readout names every step still OWNER, NEXT or UNREAD for the new id: each is manual.
    for (const r of results.filter((x) => typeof x.readout === 'string')) {
      results.push(...readoutSteps(r.readout, decl.readoutRows ?? {}, decl.readoutEstimates ?? {}, decl.readoutLanes ?? {}));
      delete r.readout;
    }
  } finally {
    if (!argv.includes('--keep')) {
      git(['worktree', 'remove', '--force', tree], ROOT);
      rmSync(base, { recursive: true, force: true });
    }
  }
  const summary = summarize(results, { asOf: today, id });
  const report = { tool: ME, id, ranAt: new Date().toISOString(), wallSeconds: Math.round((Date.now() - t0) / 1000), unexercised: decl.unexercised ?? [], steps: results, totals: summary };
  if (out) writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
  for (const r of results) {
    const mark = r.result === 'fail' ? '✗' : r.result === 'skip' ? '⬜' : r.manual ? '✋' : '✓';
    console.log(`${mark} ${r.result.padEnd(6)} ${String(r.seconds).padStart(7)}s  ${r.name}${r.manual ? `  [${r.row ?? (r.gate ? `gate ${r.gate}` : 'NO ROW')}]` : ''}${r.result !== 'pass' && r.why ? `  — ${r.why}` : ''}`);
  }
  for (const u of decl.unexercised ?? []) console.log(`⬜ not exercised on a hosted runner: ${u.target} — ${u.why}`);
  console.log(`\nautomated ${summary.automatedMinutes} min · ${summary.manualSteps} manual step(s) · time-to-ship ≈ ${summary.timeToShip.value} h (asOf ${summary.timeToShip.asOf})`);
  if (summary.failedSteps.length) console.log(`FAILED: ${summary.failedSteps.join(', ')}`);
  if (summary.unmappedManualSteps.length) console.log(`UNMAPPED MANUAL STEP(S) — each needs a register row or a lane: ${summary.unmappedManualSteps.join(', ')}`);
  if (summary.skippedSteps.length) console.log(`COVERAGE LOST — skipped: ${summary.skippedSteps.join(', ')}`);
  process.exit(exitCode(summary));
}
