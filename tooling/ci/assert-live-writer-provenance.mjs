#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-live-writer-provenance.mjs — [pipeline B-17] EVERY LIVE WRITER STAMPS
// A RESOLVABLE APP_VERSION AND HANDS ITS PURGE THE CONSENT SETTINGS.
//
// ⏱ ADDED 2026-09-23. store-screenshots.yml's Linux capture drove the app
// against production with no APP_VERSION, so two consent rows landed in
// platform_db stamped `dev` (run 35818960378), and its purge was handed nothing
// that could find them. tooling/ops/check-prod-provenance.mjs reported them a
// day later, which is the monitor doing its job one rung too late. This guard
// is the rung before it: from the tree alone, every workflow that drives the
// app live must
//
//   L1  be SEEN — a YAML `flutter drive` (workflow-scan's flutterDrives) or a
//       step that runs a script which launches `flutter drive` (a SPAWNER: a
//       .mjs under tooling/ or extensions/scripts/ that spawns `flutter` with
//       a 'drive' argument). Seeing none of either is COVERAGE LOST.
//   L2  stamp a YAML drive with --dart-define=APP_VERSION=<expr> whose value,
//       traced through step env, job env and earlier unconditional $GITHUB_ENV
//       writes and rendered for two sample runs, has the shape of the lane its
//       workflow is bound to in tooling/e2e/app-version-stamp.mjs STAMP_LANES —
//       and that lane's resolver is one the provenance register accepts.
//   L3  for a spawner: import appVersionDefine from that same module and put
//       its result into the argv that reaches the drive. An `actions-default`
//       lane is rendered by CALLING appVersionDefine with a sample Actions env.
//   L4  purge what it wrote: every job that drives has an `if: always()` purge
//       carrying PLATFORM_D1_DATABASE_ID, E2E_APP_ID and exactly ONE consent
//       source — E2E_DRIVE_LOG / E2E_RESPONSE_DATA for a YAML drive,
//       E2E_CONSENT_LEDGER for a spawner, never both (tooling/e2e/purge.mjs
//       refuses the mix) — pointed at the file the writer actually wrote.
//       Every job that provisions a throwaway user has an always() purge.
//   L5  the register widens app_version acceptance only through a stamp lane:
//       every `alsoResolves` id on a table whose marker is app_version is a
//       STAMP_LANES resolver, and every lane's resolver is registered.
//
// ⚠️ WHAT IT CANNOT SEE: a row in production. Whether a purge DID delete what it
// was handed is answerable only by the monitor (ops-watch.yml, daily). This is a
// gate over the tree: the writer and its purge are wired to each other.
//
// ⚠️ A SCRIPT-LAUNCHED `flutter build` is refused, not graded: nothing here can
// yet say which lane such a build writes under. Extend this guard first.
//
// Usage:  node tooling/ci/assert-live-writer-provenance.mjs [repoRoot]
// Exit 0 = every live writer is stamped and purged. 1 = a finding.
//      2 = COVERAGE LOST (it did not see enough to be evidence).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';
import {
  WORKFLOW_DIR,
  commandAt,
  flutterDrives,
  githubEnvWrites,
  jobEnv,
  joinShellContinuations,
  parseAllWorkflows,
  shellSegments,
  workflowSteps,
} from './workflow-scan.mjs';
import { STAMP_LANES, StampRefused, appVersionDefine, laneByResolver, laneForWorkflow, stampShape } from '../e2e/app-version-stamp.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const REGISTER_REL = 'tooling/prod-provenance.json';
const STAMP_MODULE_REL = 'tooling/e2e/app-version-stamp.mjs';
const SPAWNER_ROOTS = ['tooling', 'extensions/scripts'];
const SPAWNER_SKIP = new Set(['test', 'fixtures', 'node_modules']);
const PROVISION_REL = 'tooling/e2e/provision_user.mjs';
const PURGE_REL = 'tooling/e2e/purge.mjs';
const DRIVE_FAMILY = ['E2E_DRIVE_LOG', 'E2E_RESPONSE_DATA'];
const LEDGER = 'E2E_CONSENT_LEDGER';
const PURGE_NEEDS = ['PLATFORM_D1_DATABASE_ID', 'E2E_APP_ID'];
const SAMPLE_RUNS = ['1', '123456789'];
const SAMPLE_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const MAX_DEPTH = 6;

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fileOf = (rel) => rel.split('/').pop();
const nodeRuns = (rel) => `node(?:\\s+-\\S+)*\\s+(?:\\./)?${esc(rel)}(?=\\s|$)`;

// ── the register ─────────────────────────────────────────────────────────────
let reg;
try {
  reg = JSON.parse(readFileSync(join(ROOT, REGISTER_REL), 'utf8'));
} catch (e) {
  coverageLost([`${REGISTER_REL} is unreadable or not JSON — ${e.message}`, 'Without it no lane resolver can be checked against what the monitor accepts.']);
}
const resolvers = reg?.resolvers;
const tables = reg?.tables;
const consentAlso = tables?.consent_artifacts?.alsoResolves;
if (!resolvers || typeof resolvers !== 'object' || Array.isArray(resolvers) || !tables || typeof tables !== 'object' || !Array.isArray(consentAlso)) {
  coverageLost([
    `${REGISTER_REL} has no \`resolvers\` object, no \`tables\` object, or no \`tables.consent_artifacts.alsoResolves\` array.`,
    'Those three are what a stamp lane must be registered in; malformed, every lane would be judged against nothing.',
  ]);
}

// ── L1: the census ───────────────────────────────────────────────────────────
const workflows = parseAllWorkflows(ROOT);
if (workflows.length === 0) coverageLost([`read ZERO workflows under ${WORKFLOW_DIR}. The scan is broken, not the tree.`]);
const drives = flutterDrives(ROOT, workflows);

/** From `code[i]`, skip a string or template literal; returns the index after it. */
function skipLiteral(code, i) {
  const q = code[i];
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') { j++; continue; }
    if (code[j] === q) return j + 1;
  }
  return code.length;
}
/** The bracketed text from `code[i]` (a `[`) to its match, strings skipped. */
function bracketFrom(code, i) {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === '"' || c === "'" || c === '`') { j = skipLiteral(code, j) - 1; continue; }
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') { depth--; if (depth === 0) return code.slice(i, j + 1); }
  }
  return code.slice(i);
}
/** The initialiser of `const|let|var <id> = …;`, to the `;` at bracket depth 0. */
function declarationOf(code, id) {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${esc(id)}\\s*=`).exec(code);
  if (!m) return null;
  let depth = 0;
  for (let j = m.index + m[0].length; j < code.length; j++) {
    const c = code[j];
    if (c === '"' || c === "'" || c === '`') { j = skipLiteral(code, j) - 1; continue; }
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') depth--;
    else if (c === ';' && depth === 0) return code.slice(m.index + m[0].length, j);
  }
  return code.slice(m.index + m[0].length);
}
const lineAt = (code, index) => code.slice(0, index).split('\n').length;

const spawners = [];
let scannedScripts = 0;
const walk = (rel) => {
  if (!existsSync(join(ROOT, rel))) return;
  for (const e of listDir(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!SPAWNER_SKIP.has(e.name) && !e.name.startsWith('.')) walk(child);
      continue;
    }
    if (!e.name.endsWith('.mjs')) continue;
    scannedScripts++;
    const code = stripSourceComments(readFileSync(join(ROOT, child), 'utf8'), '.mjs');
    for (const m of code.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*(['"`])flutter\1\s*,\s*(\[|[A-Za-z_$][\w$]*)/g)) {
      const argsText = m[2] === '[' ? bracketFrom(code, m.index + m[0].length - 1) : declarationOf(code, m[2]);
      if (argsText === null) continue;
      const kind = /(['"`])drive\1/.test(argsText) ? 'drive' : /(['"`])build\1/.test(argsText) ? 'build' : null;
      if (kind === null) continue;
      spawners.push({ rel: child, kind, line: lineAt(code, m.index), argsText, code });
    }
  }
};
for (const r of SPAWNER_ROOTS) walk(r);
if (scannedScripts === 0) coverageLost([`read ZERO .mjs files under ${SPAWNER_ROOTS.join(', ')}. The walk is broken, not the tree.`]);
const spawnerFiles = [...new Set(spawners.map((s) => s.rel))];

/** Every step of every job, with the shell segments its run holds. */
const stepsOf = [];
for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    const jEnv = jobEnv(job);
    for (const step of workflowSteps(job)) {
      const segs = step.run === null ? [] : shellSegments(joinShellContinuations(step.run.text));
      stepsOf.push({ wf, job, jEnv, step, segs });
    }
  }
}
const runsScript = (s, rel) => s.segs.some((seg) => commandAt(seg, nodeRuns(rel)));
const spawnerSteps = [];
for (const s of stepsOf) for (const rel of spawnerFiles) if (runsScript(s, rel)) spawnerSteps.push({ ...s, spawner: rel });
const provisions = stepsOf.filter((s) => runsScript(s, PROVISION_REL));
const purges = stepsOf.filter((s) => runsScript(s, PURGE_REL));
const jobKey = (s) => `${s.wf.rel}#${s.job.name}`;
const provisioningJobs = new Set(provisions.map(jobKey));

if (drives.length + spawnerSteps.length === 0) {
  coverageLost([
    `found ZERO live drives: no \`flutter drive\` in ${workflows.length} workflow(s) and no step running any of ${spawnerFiles.length} spawner script(s).`,
    'e2e.yml drives the app nightly and store-screenshots.yml runs the capture; seeing neither means a reader stopped matching.',
  ]);
}
if (provisions.length === 0) coverageLost([`found ZERO steps running ${PROVISION_REL}. Every live lane provisions a throwaway user; the step reader stopped matching.`]);
for (const lane of STAMP_LANES) {
  const wf = workflows.find((w) => fileOf(w.rel) === lane.workflow);
  if (!wf) coverageLost([`the \`${lane.resolver}\` stamp lane names ${lane.workflow}, which is not under ${WORKFLOW_DIR}.`, `Update STAMP_LANES in ${STAMP_MODULE_REL} in the same change that moves or deletes the workflow.`]);
  const seen = drives.some((d) => d.workflow === wf.rel) || spawnerSteps.some((s) => s.wf.rel === wf.rel);
  if (!seen) coverageLost([`the \`${lane.resolver}\` stamp lane's ${wf.rel} has no \`flutter drive\` and no spawner step this guard can see.`, 'Either the lane stopped driving (retire it from STAMP_LANES) or a reader stopped matching.']);
}

const problems = [];
const at = (wfRel, n, job) => `${wfRel}:${n} (job "${job}")`;

// ── the stamp: trace and render ──────────────────────────────────────────────
/** Where `$name` comes from, seen from step `stepIndex` of `job`: `{ expr, stepIndex }`, or `{ why }`. */
function lookup(name, job, jEnv, stepIndex) {
  const step = workflowSteps(job)[stepIndex];
  if (step?.env.has(name)) return { expr: step.env.get(name).value, stepIndex };
  if (jEnv.has(name)) return { expr: jEnv.get(name).value, stepIndex };
  const writes = githubEnvWrites(job).filter((w) => w.name === name);
  const earlier = writes.filter((w) => w.stepIndex < stepIndex);
  const conditional = earlier.find((w) => w.cond !== null);
  if (conditional) return { why: `$${name} is written to $GITHUB_ENV by a conditional step (\`if: ${conditional.cond}\`, line ${conditional.n}), so a run that skips that step drives with it unset` };
  if (earlier.length) { const w = earlier[earlier.length - 1]; return { expr: w.expr, stepIndex: w.stepIndex }; }
  if (writes.length) return { why: `$${name} is written to $GITHUB_ENV only AFTER the step that reads it (line ${writes[0].n})` };
  return { why: `$${name} is untraceable: no step env, no job env and no earlier $GITHUB_ENV write sets it` };
}

/** The value `expr` takes on run `run` of `wf`, or throws Error(why). */
function render(expr, ctx, run, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error(`cannot render \`${expr}\`: variables nest deeper than ${MAX_DEPTH}`);
  let out = '';
  let rest = String(expr);
  const rules = [
    [/^\$\{\{\s*github\.run_number\s*\}\}/, () => run],
    [/^\$\{\{\s*github\.sha\s*\}\}/, () => SAMPLE_SHA],
    [/^\$\{GITHUB_SHA::7\}/, () => SAMPLE_SHA.slice(0, 7)],
    [/^(?:\$GITHUB_RUN_NUMBER\b|\$\{GITHUB_RUN_NUMBER\})/, () => run],
    [/^(?:\$GITHUB_SHA\b|\$\{GITHUB_SHA\})/, () => SAMPLE_SHA],
    [/^\$\{\{[^}]*\}\}/, (m) => { throw new Error(`cannot render \`${m[0]}\`: only github.run_number and github.sha are known`); }],
    [/^(?:\$\(|`)/, () => { throw new Error(`cannot render \`${expr}\`: a command substitution is decided only when the job runs`); }],
    [/^(?:\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*))/, (m) => {
      const found = lookup(m[1] ?? m[2], ctx.job, ctx.jEnv, ctx.stepIndex);
      if (found.why) throw new Error(found.why);
      return render(found.expr, { ...ctx, stepIndex: found.stepIndex }, run, depth + 1);
    }],
    [/^\$/, () => { throw new Error(`cannot render \`${expr}\`: a stray \`$\``); }],
  ];
  while (rest !== '') {
    let hit = false;
    for (const [re, fn] of rules) {
      const m = re.exec(rest);
      if (!m) continue;
      out += fn(m);
      rest = rest.slice(m[0].length);
      hit = true;
      break;
    }
    if (!hit) { out += rest[0]; rest = rest.slice(1); }
  }
  return out.replace(/^(['"])(.*)\1$/, '$2');
}

/** Both sample renders against the lane's shape; a finding string, or null. */
function judgeRender(where, lane, renders) {
  for (const v of renders) {
    if (stampShape(lane.prefix).test(v)) continue;
    const other = STAMP_LANES.find((l) => l !== lane && stampShape(l.prefix).test(v));
    return other
      ? `${where} — stamps APP_VERSION=${v}, the \`${other.resolver}\` lane's shape, in a workflow bound to \`${lane.resolver}\`: the monitor would look for that run in the wrong workflow's history.`
      : `${where} — stamps APP_VERSION=${v}, which is not ${lane.prefix}-<run>-<sha7>, the shape the \`${lane.resolver}\` resolver accepts.`;
  }
  return null;
}
function judgeResolver(where, lane) {
  if (!Object.prototype.hasOwnProperty.call(resolvers, lane.resolver)) return `${where} — its lane's resolver \`${lane.resolver}\` is not a key of ${REGISTER_REL} \`resolvers\`.`;
  if (!consentAlso.includes(lane.resolver)) return `${where} — its lane's resolver \`${lane.resolver}\` is not in ${REGISTER_REL} tables.consent_artifacts.alsoResolves, so the monitor refuses every row it stamps.`;
  return null;
}

// ── L2: YAML drives ──────────────────────────────────────────────────────────
for (const d of drives) {
  const wf = workflows.find((w) => w.rel === d.workflow);
  const job = wf.jobs.get(d.job);
  const where = at(d.workflow, d.runLine, d.job);
  const lane = laneForWorkflow(fileOf(d.workflow));
  if (!lane) {
    problems.push(`${where} — a live \`flutter drive\` in a workflow bound to no stamp lane. Add ${fileOf(d.workflow)} to STAMP_LANES in ${STAMP_MODULE_REL} and its resolver to ${REGISTER_REL}.`);
    continue;
  }
  if (d.appVersionExpr === null || d.appVersionExpr === 'dev') {
    problems.push(`${where} — the drive passes ${d.appVersionExpr === null ? 'no --dart-define=APP_VERSION' : 'APP_VERSION=dev'}, so every row it writes is stamped \`dev\` and no resolver can attribute it.`);
    continue;
  }
  const ctx = { job, jEnv: jobEnv(job), stepIndex: d.stepIndex };
  let renders;
  try {
    renders = SAMPLE_RUNS.map((run) => render(d.appVersionExpr, ctx, run));
  } catch (e) {
    problems.push(`${where} — APP_VERSION=${d.appVersionExpr}: ${e.message}.`);
    continue;
  }
  const shape = judgeRender(where, lane, renders);
  if (shape) { problems.push(shape); continue; }
  const r = judgeResolver(where, lane);
  if (r) problems.push(r);
}

// ── L3: spawners ─────────────────────────────────────────────────────────────
const IMPORTS_DEFINE = /import\s*\{[^}]*\bappVersionDefine\b[^}]*\}\s*from\s*(['"])[^'"]*app-version-stamp\.mjs\1/;
function reachesArgv(sp) {
  if (/\.\.\.\s*appVersionDefine\(/.test(sp.argsText)) return true;
  const spread = [...sp.argsText.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const held = [...sp.code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*appVersionDefine\(/g)].map((m) => m[1]);
  for (const x of spread) {
    if (new RegExp(`\\b${esc(x)}\\.push\\(\\s*\\.\\.\\.\\s*appVersionDefine\\(`).test(sp.code)) return true;
    if (held.includes(x)) return true;
    for (const y of held) if (new RegExp(`\\b${esc(x)}\\.push\\([^)]*\\.\\.\\.\\s*${esc(y)}\\b`).test(sp.code)) return true;
  }
  return false;
}
for (const sp of spawners) {
  const where = `${sp.rel}:${sp.line}`;
  if (sp.kind === 'build') {
    problems.push(`${where} — a script-launched flutter build is not yet supported: extend this guard before adding one (which lane does it write under, and what purges it?).`);
    continue;
  }
  if (!IMPORTS_DEFINE.test(sp.code)) {
    problems.push(`${where} — launches a live \`flutter drive\` and does not import appVersionDefine from ${STAMP_MODULE_REL}, so nothing stamps its rows.`);
    continue;
  }
  if (!reachesArgv(sp)) {
    problems.push(`${where} — imports appVersionDefine, but its result never reaches the argv of this drive: spread it into the args, push it onto an array spread there, or hold it in a name that is.`);
  }
}
for (const s of spawnerSteps) {
  const where = at(s.wf.rel, s.step.run.n, s.job.name);
  const lane = laneForWorkflow(fileOf(s.wf.rel));
  if (!lane) {
    problems.push(`${where} — a spawner step (${s.spawner}) in a workflow bound to no stamp lane. Add ${fileOf(s.wf.rel)} to STAMP_LANES in ${STAMP_MODULE_REL}.`);
    continue;
  }
  const named = [...new Set(spawners.filter((sp) => sp.rel === s.spawner).flatMap((sp) => [...sp.code.matchAll(/appVersionDefine\(\s*\{[^}]*\blane:\s*(['"])([^'"]+)\1/g)].map((m) => m[2])))];
  const stranger = named.find((id) => id !== lane.resolver);
  if (stranger) {
    problems.push(`${where} — runs ${s.spawner}, which stamps the \`${stranger}\` lane, from ${fileOf(s.wf.rel)}, which is bound to \`${lane.resolver}\`.`);
    continue;
  }
  let renders;
  try {
    if (lane.source === 'actions-default') {
      renders = SAMPLE_RUNS.map((run) => {
        const argv = appVersionDefine({
          lane: lane.resolver,
          live: true,
          env: { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW_REF: `o/r/${s.wf.rel}@refs/heads/main`, GITHUB_RUN_NUMBER: run, GITHUB_SHA: SAMPLE_SHA },
        });
        return String(argv.find((a) => String(a).startsWith('APP_VERSION=')) ?? '').replace(/^APP_VERSION=/, '');
      });
    } else {
      const found = lookup(lane.env, s.job, s.jEnv, s.step.index);
      if (found.why) throw new Error(found.why);
      const ctx = { job: s.job, jEnv: s.jEnv, stepIndex: found.stepIndex };
      renders = SAMPLE_RUNS.map((run) => render(found.expr, ctx, run));
    }
  } catch (e) {
    const why = e instanceof StampRefused ? `the stamp module REFUSES this lane here: ${e.message}` : e.message;
    problems.push(`${where} — ${s.spawner}: ${why}.`);
    continue;
  }
  const shape = judgeRender(where, lane, renders);
  if (shape) { problems.push(shape); continue; }
  const r = judgeResolver(where, lane);
  if (r) problems.push(r);
}

// ── L4: the purge is handed what the writer wrote ────────────────────────────
const envOf = (s, key) => (s.step.env.get(key) ?? s.jEnv.get(key))?.value ?? null;
// Two readings of one path. An `env:` value is expanded by Actions for `${{ }}`
// only: `$RUNNER_TEMP` there reaches purge.mjs as those literal characters. A
// `run:` line is expanded by Actions and then by the shell, so a tee target may
// name the runner temp dir any of three ways.
const unquotePath = (v) => String(v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
const envPath = (v) => unquotePath(v).replace(/\$\{\{\s*runner\.temp\s*\}\}/g, '<RUNNER_TEMP>');
const shellPath = (v) => unquotePath(v).replace(/\$\{\{\s*runner\.temp\s*\}\}|\$\{RUNNER_TEMP\}|\$RUNNER_TEMP\b/g, '<RUNNER_TEMP>');
const purgeFacts = (p) => {
  const drive = DRIVE_FAMILY.filter((k) => envOf(p, k) !== null);
  const ledger = envOf(p, LEDGER) !== null;
  const always = /\balways\(\)/.test(p.step.cond ?? '');
  const lacks = [];
  if (!always) lacks.push('`if: always()`');
  for (const k of PURGE_NEEDS) if (envOf(p, k) === null) lacks.push(k);
  return { drive, ledger, always, lacks };
};
for (const p of purges) {
  const f = purgeFacts(p);
  if (f.drive.length && f.ledger) {
    problems.push(`${at(p.wf.rel, p.step.run.n, p.job.name)} — the purge carries both ${f.drive.join(' + ')} and ${LEDGER}; ${PURGE_REL} refuses the mix, so this purge deletes nothing.`);
  }
}
const writerJobs = new Map();
const addWriter = (key, entry) => { if (!writerJobs.has(key)) writerJobs.set(key, { drives: [], spawners: [] }); writerJobs.get(key)[entry.kind].push(entry.item); };
for (const d of drives) addWriter(`${d.workflow}#${d.job}`, { kind: 'drives', item: d });
for (const s of spawnerSteps) addWriter(jobKey(s), { kind: 'spawners', item: s });
for (const [key, w] of writerJobs) {
  const jobPurges = purges.filter((p) => jobKey(p) === key);
  const lackLines = (source) =>
    jobPurges.map((p) => {
      const f = purgeFacts(p);
      const missing = [...f.lacks];
      if (source === 'drive' && f.drive.length === 0) missing.push(`${DRIVE_FAMILY.join(' or ')}`);
      if (source === 'ledger' && !f.ledger) missing.push(LEDGER);
      const wrong = source === 'drive' ? (f.ledger ? [LEDGER] : []) : f.drive;
      const said = [];
      if (missing.length) said.push(`lacks ${missing.join(', ')}`);
      if (wrong.length) said.push(`carries ${wrong.join(' / ')}, which a ${source === 'drive' ? "drive's" : "spawner's"} purge must not`);
      return `${at(p.wf.rel, p.step.run.n, p.job.name)} ${said.join(' and ')}`;
    });
  if (w.drives.length) {
    const ok = jobPurges.filter((p) => { const f = purgeFacts(p); return f.lacks.length === 0 && f.drive.length > 0 && !f.ledger; });
    if (ok.length === 0) {
      const d = w.drives[0];
      problems.push(
        jobPurges.length === 0
          ? `${at(d.workflow, d.runLine, d.job)} — drives the app live and the job runs no ${PURGE_REL} at all.`
          : `${at(d.workflow, d.runLine, d.job)} — no purge in this job is a consenting one (always(), ${PURGE_NEEDS.join(', ')}, ${DRIVE_FAMILY.join(' / ')}): ${lackLines('drive').join('; ')}.`,
      );
    }
    for (const d of w.drives) {
      for (const p of ok) {
        const log = envOf(p, 'E2E_DRIVE_LOG');
        if (log === null) continue;
        if (d.teeTarget === null || envPath(log) !== shellPath(d.teeTarget)) {
          problems.push(`${at(p.wf.rel, p.step.run.n, p.job.name)} — E2E_DRIVE_LOG=${log}, but the drive at line ${d.runLine} ${d.teeTarget === null ? 'tees its output nowhere' : `tees into ${d.teeTarget}`}: the purge would read a log that holds none of this run's install ids.`);
        }
      }
    }
  }
  if (w.spawners.length) {
    const ok = jobPurges.filter((p) => { const f = purgeFacts(p); return f.lacks.length === 0 && f.ledger && f.drive.length === 0; });
    if (ok.length === 0) {
      const s = w.spawners[0];
      problems.push(
        jobPurges.length === 0
          ? `${at(s.wf.rel, s.step.run.n, s.job.name)} — runs ${s.spawner} live and the job runs no ${PURGE_REL} at all.`
          : `${at(s.wf.rel, s.step.run.n, s.job.name)} — no purge in this job is a consenting one (always(), ${PURGE_NEEDS.join(', ')}, ${LEDGER}): ${lackLines('ledger').join('; ')}.`,
      );
    }
    for (const s of w.spawners) {
      const ledger = envOf(s, LEDGER);
      if (ledger === null) {
        problems.push(`${at(s.wf.rel, s.step.run.n, s.job.name)} — runs ${s.spawner} with no ${LEDGER}: the runner records no install id, and its purge could find none of this run's rows.`);
        continue;
      }
      for (const p of ok) {
        const theirs = envOf(p, LEDGER);
        if (envPath(theirs) !== envPath(ledger)) {
          problems.push(`${at(p.wf.rel, p.step.run.n, p.job.name)} — ${LEDGER}=${theirs}, but the spawner step at line ${s.step.run.n} writes ${ledger}.`);
        }
      }
    }
  }
}
for (const key of provisioningJobs) {
  const always = purges.some((p) => jobKey(p) === key && /\balways\(\)/.test(p.step.cond ?? ''));
  if (!always) {
    const p = provisions.find((s) => jobKey(s) === key);
    problems.push(`${at(p.wf.rel, p.step.run.n, p.job.name)} — provisions a throwaway production user and no \`if: always()\` step in the job runs ${PURGE_REL}, so a failed run leaves the account behind.`);
  }
}

// ── L5: the register widens app_version only through a stamp lane ────────────
for (const lane of STAMP_LANES) {
  const r = judgeResolver(`${STAMP_MODULE_REL} STAMP_LANES \`${lane.resolver}\``, lane);
  if (r) problems.push(r);
}
for (const [name, t] of Object.entries(tables)) {
  if (t?.marker !== 'app_version' || !Array.isArray(t.alsoResolves)) continue;
  for (const id of t.alsoResolves) {
    if (!laneByResolver(id)) {
      problems.push(`${REGISTER_REL} tables.${name} — the register widens app_version acceptance through \`${id}\`, which no stamp lane in ${STAMP_MODULE_REL} defines, so no writer is held to its shape.`);
    }
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ live writer provenance — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline B-17] Every row a live drive writes to production must carry a stamp the monitor can');
  console.error('  attribute, and its purge must be handed the settings that find it.');
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
}
console.log(
  `ok  live writer provenance — drives=${drives.length} spawners=${spawnerFiles.length} spawnerSteps=${spawnerSteps.length} ` +
    `provisioningJobs=${provisioningJobs.size} purges=${purges.length} lanes=${STAMP_LANES.length}`,
);
for (const d of drives) console.log(`    drive   ${at(d.workflow, d.runLine, d.job)} APP_VERSION=${d.appVersionExpr}`);
for (const s of spawnerSteps) console.log(`    spawner ${at(s.wf.rel, s.step.run.n, s.job.name)} ${s.spawner}`);
console.log('⬜  a gate over the tree: whether a purge DID delete its rows is answered only by tooling/ops/check-prod-provenance.mjs (ops-watch.yml, daily).');
