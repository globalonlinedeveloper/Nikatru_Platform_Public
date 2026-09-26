// ─────────────────────────────────────────────────────────────────────────────
// failure-ledger-lane.test.mjs — the failed-run ledger RUNS, weekly, under the
// job's own token, and a quota too low to spend is COVERAGE LOST, never a skip.
//
// Row O-FAILURE-LEDGER-NEVER-RUNS. tooling/ops/triage-failed-runs.mjs graded
// every failed run against tooling/ops/failed-run-causes.json, and no workflow
// ran it: the ledger existed only when a person remembered it. This suite holds
// the lane that makes it a duty — the `failure-ledger` job of ops-watch.yml —
// and the register row that makes the job's absence a finding.
//
//   L1  the job exists, on the digest's Monday slot and on dispatch only
//   L2  its ceiling, its three read scopes, and a full clone for the merge-base check
//   L3  the credential: the job's own `github.token`, and no secret (D1, 2026-09-25)
//   L4  the invocation: --since, --no-prs, --branch main, --cache-dir
//   L5  the step's shell, EXECUTED under bash: the quota floor -> exit 2; the
//       reader's exit and UNEXPLAINED count reach the job outputs unchanged
//   L6  the job is wired: alert needs it, the digest reports it
//   L7  the register row reads THIS job, and only this row does
//
// Every case reads the REAL workflow and the REAL register. The shell cases run
// the step's own `run:` text in a temp directory, against a stub reader or
// against a COPY of the real reader whose `fetch` is replaced in the child, so
// no case can reach the network.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseWorkflow, workflowSteps, jobEnv } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const WORKFLOW = '.github/workflows/ops-watch.yml';
const JOB = 'failure-ledger';
const SLOT = "github.event.schedule == '45 7 * * 1' || github.event_name == 'workflow_dispatch'";
// ⏱ 2026-09-26 · the LEDGER job runs on the Monday slot, or on a dispatch that asks for it: every land script
// dispatches ops-watch after a merge, and #526/#527 went red on the first two. The digest keeps SLOT.
const LEDGER_SLOT = "github.event.schedule == '45 7 * * 1' || (github.event_name == 'workflow_dispatch' && inputs.failure_ledger)";
const OPS = join(REPO, 'tooling', 'ops');
/** The shape of the installation token `github.token` is, built at run time. */
const FIXTURE_TOKEN = `ghs_${'a'.repeat(36)}`;

const wf = parseWorkflow(REPO, WORKFLOW);
const job = wf?.jobs.get(JOB);
const steps = workflowSteps(job);
const ledgerStep = steps.find((s) => s.id === 'ledger');
const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'ops', 'register.json'), 'utf8'));

/** The job's comment-blanked lines, as one string. */
const jobText = () => (job?.lines ?? []).map((l) => l.text).join('\n');

/** The RAW `run: |` body of a step, dedented, read from disk rather than from
 *  the comment-blanked parse, because this text is handed to bash verbatim. */
function rawRunBlock(step) {
  const raw = readFileSync(join(REPO, WORKFLOW), 'utf8').split('\n');
  const at = step.run.n - 1;
  assert.match(raw[at], /^\s+run:\s*\|\s*$/, `${WORKFLOW}:${step.run.n} is not a \`run: |\` block`);
  const indent = raw[at].match(/^(\s*)/)[1].length + 2;
  const body = [];
  for (let i = at + 1; i < raw.length; i++) {
    const line = raw[i];
    if (line.trim() !== '' && line.match(/^(\s*)/)[1].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

const TEMPS = [];
after(() => {
  for (const d of TEMPS) rmSync(d, { recursive: true, force: true });
});

/** The child's `fetch`, loaded with `--import` before the reader: every path it
 *  is asked for is appended to LEDGER_LANE_FETCH_LOG; /rate_limit answers
 *  LEDGER_LANE_REMAINING; the run lists and the branch list answer empty, which
 *  is a window with no failed run in it. Anything else is a 404. */
const FETCH_STUB = `import { appendFileSync } from 'node:fs';
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url) => {
  const path = new URL(String(url)).pathname;
  appendFileSync(process.env.LEDGER_LANE_FETCH_LOG, path + '\\n');
  const remaining = Number(process.env.LEDGER_LANE_REMAINING);
  if (path === '/rate_limit') return json({ resources: { core: { limit: 1000, used: 1000 - remaining, remaining, reset: 1790000000 } } });
  if (path.endsWith('/actions/runs')) return json({ total_count: 0, workflow_runs: [] });
  if (path.endsWith('/branches')) return json([]);
  return new Response('{}', { status: 404 });
};
`;

/** process.env without GIT_*: an inherited GIT_DIR (a hook sets one) would point
 *  the fixture's `git init`, `commit` and `update-ref` at the real repository. */
const envWithoutGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: 30_000, env: envWithoutGit() });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};

/** Put a COPY of the REAL reader at `dir`/tooling/ops, its two sibling imports
 *  re-pointed at the real files, beside a one-row causes register that names no
 *  merge, in a git repository whose origin/main resolves. The merge-base check
 *  then holds nothing and answers, so the next thing the reader does is the
 *  quota read. Returns the child env that installs FETCH_STUB, and the log. */
function stageRealReader(dir, { remaining }) {
  const at = join(dir, 'tooling', 'ops');
  mkdirSync(at, { recursive: true });
  const src = readFileSync(join(OPS, 'triage-failed-runs.mjs'), 'utf8')
    .replace("from './safe-rerun.mjs'", `from ${JSON.stringify(pathToFileURL(join(OPS, 'safe-rerun.mjs')).href)}`)
    .replace("from './bounded-retry.mjs'", `from ${JSON.stringify(pathToFileURL(join(OPS, 'bounded-retry.mjs')).href)}`);
  assert.doesNotMatch(src, /from '\.\.?\//, 'the reader imports a relative module this copy does not re-point');
  writeFileSync(join(at, 'triage-failed-runs.mjs'), src);
  const cause = { signature: 'cancelled:by-hand-or-unknown', rootCause: 'Cancelled with no successor in its concurrency group.', fix: 'not a defect', fixedBy: { kind: 'not-a-defect', reason: 'no verdict rendered' } };
  writeFileSync(join(at, 'failed-run-causes.json'), JSON.stringify({ causes: [cause] }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'fixture');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const log = join(dir, 'fetch-log.txt');
  writeFileSync(log, '');
  const stub = join(dir, 'fetch-stub.mjs');
  writeFileSync(stub, FETCH_STUB);
  return { log, env: { NODE_OPTIONS: `--import=${pathToFileURL(stub).href}`, LEDGER_LANE_FETCH_LOG: log, LEDGER_LANE_REMAINING: String(remaining) } };
}

/** Run the ledger step's own shell the way Actions runs a `run:` with no
 *  `shell:` key (`bash -e`), in a temp cwd whose tooling/ops/triage-failed-runs.mjs
 *  is `stub` (or absent when `stub` is null), or the real reader when `realReader`
 *  is `{ remaining }`. Returns {code, stdout, outputs, fetched}. */
function runLedgerStep({ token, stub, realReader = null }) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-lane-'));
  TEMPS.push(dir);
  if (stub !== null) {
    mkdirSync(join(dir, 'tooling', 'ops'), { recursive: true });
    writeFileSync(join(dir, 'tooling', 'ops', 'triage-failed-runs.mjs'), stub);
  }
  const staged = realReader ? stageRealReader(dir, realReader) : { log: null, env: {} };
  const outputFile = join(dir, 'github-output.txt');
  writeFileSync(outputFile, '');
  const runnerTemp = join(dir, 'runner-temp');
  mkdirSync(runnerTemp);
  const r = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', rawRunBlock(ledgerStep)], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...envWithoutGit(),
      GH_TOKEN: token,
      GITHUB_REPOSITORY: 'fixture-owner/fixture-repo',
      GITHUB_OUTPUT: outputFile.replace(/\\/g, '/'),
      RUNNER_TEMP: runnerTemp.replace(/\\/g, '/'),
      ...staged.env,
    },
  });
  const outputs = Object.fromEntries(
    readFileSync(outputFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const fetched = staged.log ? readFileSync(staged.log, 'utf8').split('\n').filter(Boolean) : [];
  return { code: r.status, stdout: `${r.stdout}${r.stderr}`, outputs, fetched };
}

describe('L1 — the job exists, on the Monday slot and on dispatch only', () => {
  test('ops-watch.yml has a `failure-ledger` job', () => {
    assert.ok(wf, `${WORKFLOW} did not parse`);
    assert.ok(job, `${WORKFLOW} has no \`${JOB}\` job — the ledger is back to running when a person remembers it`);
  });

  test("the job's `if:` is the Monday slot, or a dispatch that asks for it (inputs.failure_ledger)", () => {
    assert.equal(job?.jobIf?.cond, LEDGER_SLOT);
  });

  test('the digest carries the same slot predicate, so the two cannot fire on different slots', () => {
    const digest = wf.jobs.get('digest');
    assert.ok(digest?.jobIf?.cond.includes(`(${SLOT})`), `digest's if: is ${JSON.stringify(digest?.jobIf?.cond)}`);
  });

  test("the slot predicate names a cron the workflow actually schedules", () => {
    const crons = wf.lines.map((l) => l.text.match(/^\s+-\s+cron:\s*'([^']+)'/)?.[1]).filter(Boolean);
    assert.ok(crons.includes('45 7 * * 1'), `schedule has ${JSON.stringify(crons)}`);
  });
});

describe('L2 — ceiling, permissions, and a full clone', () => {
  test('timeout-minutes is 20', () => {
    assert.match(jobText(), /^ {4}timeout-minutes:\s*20\s*$/m);
  });

  test('permissions are exactly `contents: read`, `actions: read` and `pull-requests: read` (D1)', () => {
    const lines = job.lines.map((l) => l.text);
    const at = lines.findIndex((t) => /^ {4}permissions:\s*$/.test(t));
    assert.notEqual(at, -1, 'the job declares no permissions block, so it inherits the workflow default');
    const granted = [];
    for (const t of lines.slice(at + 1)) {
      if (t.trim() === '') continue;
      const m = t.match(/^ {6}([a-z-]+):\s*(\S+)\s*$/);
      if (!m) break;
      granted.push(`${m[1]}: ${m[2]}`);
    }
    // The job's own token is the reader's credential, so these three scopes are
    // everything it can read with, and nothing it could write with.
    assert.deepEqual(granted.sort(), ['actions: read', 'contents: read', 'pull-requests: read']);
  });

  test('checkout fetches full history and keeps no credential', () => {
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    assert.ok(checkout, 'the job has no checkout step');
    assert.equal(checkout.with.get('fetch-depth')?.value, '0', 'a shallow clone makes the merge-base check exit 2 every week');
    assert.equal(checkout.with.get('persist-credentials')?.value, 'false');
  });

  test('the log cache is keyed by ISO week', () => {
    const cache = steps.find((s) => s.uses?.startsWith('actions/cache@'));
    assert.equal(cache?.with.get('path')?.value, '.cache/triage');
    assert.equal(cache?.with.get('key')?.value, 'failure-ledger-${{ steps.week.outputs.week }}');
  });
});

// D1 (2026-09-25) reversed this block: no PAT is minted. The job's own token
// reads this repository, and the reader's quota floor guards the shared quota.
describe("L3 — the credential is the job's own github.token, and no secret", () => {
  test('the ledger step sets GH_TOKEN from github.token', () => {
    assert.ok(ledgerStep, 'the job has no step with id `ledger`');
    assert.equal(ledgerStep.env.get('GH_TOKEN')?.value, '${{ github.token }}');
  });

  test('the job names no secret: the ledger needs none', () => {
    assert.doesNotMatch(jobText(), /secrets\./);
  });

  test('ops-watch.yml names GH_LEDGER_TOKEN nowhere, comments included', () => {
    assert.doesNotMatch(readFileSync(join(REPO, WORKFLOW), 'utf8'), /GH_LEDGER_TOKEN/);
  });

  test('the job sets no job-level env a step could read a token from', () => {
    assert.deepEqual([...jobEnv(job).keys()], []);
  });
});

describe('L4 — the invocation', () => {
  test('the step runs the reader with --since, --no-prs, --branch main and --cache-dir .cache/triage', () => {
    const run = ledgerStep.run.text;
    // FIX-1 (C), 2026-09-25: main's runs only; a PR's own reds belong to that PR.
    assert.match(run, /node tooling\/ops\/triage-failed-runs\.mjs --since "\$since" --no-prs --branch main --cache-dir \.cache\/triage/);
  });

  test('--since is eight days back, one day wider than the weekly cadence', () => {
    assert.match(ledgerStep.run.text, /since="\$\(date -u -d '8 days ago' \+%Y-%m-%dT%H:%M:%SZ\)"/);
  });

  test('the job exposes the step outputs `exit` and `unexplained`', () => {
    assert.match(jobText(), /^ {6}exit:\s*\$\{\{ steps\.ledger\.outputs\.exit \}\}\s*$/m);
    assert.match(jobText(), /^ {6}unexplained:\s*\$\{\{ steps\.ledger\.outputs\.unexplained \}\}\s*$/m);
  });
});

describe('L5 — the step shell, executed under bash', () => {
  test('the quota floor: /rate_limit says 350 remaining against the 300 ceiling -> exit 2, `exit=2` written, "quota floor" printed, and the reader never started', () => {
    const r = runLedgerStep({ token: FIXTURE_TOKEN, stub: null, realReader: { remaining: 350 } });
    assert.equal(r.code, 2, r.stdout);
    assert.equal(r.outputs.exit, '2');
    assert.equal(r.outputs.unexplained, 'none printed');
    assert.match(r.stdout, /✗ COVERAGE LOST — quota floor — 350 remaining - ceiling 300 = 50, under the floor of 400/);
    assert.match(r.stdout, /::error title=The failed-run ledger is UNKNOWN/);
    assert.deepEqual(r.fetched, ['/rate_limit'], 'the uncounted quota read is the only request; the walk never sent one');
    assert.doesNotMatch(r.stdout, /triage-failed-runs — /);
  });

  test('GREEN CONTROL — 1000 remaining clears the floor: the same real reader starts, walks an empty window, and exit 0 reaches the outputs', () => {
    const r = runLedgerStep({ token: FIXTURE_TOKEN, stub: null, realReader: { remaining: 1000 } });
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.outputs.exit, '0');
    assert.equal(r.outputs.unexplained, '0');
    assert.match(r.stdout, /quota floor: 1000 remaining - ceiling 300 = 700 >= 400; the walk may start/);
    assert.equal(r.fetched[0], '/rate_limit');
    assert.ok(r.fetched.length > 1, `the walk sent no counted request: ${JSON.stringify(r.fetched)}`);
    assert.match(r.stdout, new RegExp(`REQUESTS: ${r.fetched.length - 1} sent, ceiling 300`));
  });

  test('the reader exits 1 with UNEXPLAINED: 3 -> the step exits 1 and the outputs carry 1 and 3', () => {
    const r = runLedgerStep({ token: 'fixture-not-a-token', stub: "console.log('UNEXPLAINED: 3'); process.exit(1);\n" });
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.outputs.exit, '1');
    assert.equal(r.outputs.unexplained, '3');
    assert.match(r.stdout, /UNEXPLAINED: 3/);
    assert.match(r.stdout, /::error title=A failed run has no recorded cause/);
  });

  test('the reader exits 0 with UNEXPLAINED: 0 -> the step exits 0 and the outputs carry 0 and 0', () => {
    const r = runLedgerStep({ token: 'fixture-not-a-token', stub: "console.log('UNEXPLAINED: 0'); process.exit(0);\n" });
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.outputs.exit, '0');
    assert.equal(r.outputs.unexplained, '0');
    assert.doesNotMatch(r.stdout, /::error/);
  });

  test('the reader exits 2 printing no count -> the step exits 2 and says the count was not printed', () => {
    const r = runLedgerStep({ token: 'fixture-not-a-token', stub: "console.error('COVERAGE LOST — fixture'); process.exit(2);\n" });
    assert.equal(r.code, 2, r.stdout);
    assert.equal(r.outputs.exit, '2');
    assert.equal(r.outputs.unexplained, 'none printed');
    assert.match(r.stdout, /::error title=The failed-run ledger is UNKNOWN/);
  });

  test('a reader that cannot start is a non-zero step, never a green one', () => {
    const r = runLedgerStep({ token: 'fixture-not-a-token', stub: null });
    assert.notEqual(r.code, 0, r.stdout);
    assert.notEqual(r.outputs.exit, '0');
  });
});

describe('L6 — alert needs the job, the digest reports it', () => {
  test("alert's needs include failure-ledger, so a red ledger reaches the durable issue", () => {
    assert.ok(wf.jobs.get('alert')?.needs.includes(JOB), `alert needs ${JSON.stringify(wf.jobs.get('alert')?.needs)}`);
  });

  test('the digest needs the job and runs with always(), so a red ledger is still reported', () => {
    const digest = wf.jobs.get('digest');
    assert.deepEqual(digest?.needs, [JOB]);
    assert.match(digest?.jobIf?.cond ?? '', /^always\(\) && \(/);
  });

  test("the digest reads the job's result, exit and count into its env", () => {
    const text = wf.jobs.get('digest').lines.map((l) => l.text).join('\n');
    assert.match(text, /LEDGER_RESULT: \$\{\{ needs\.failure-ledger\.result \}\}/);
    assert.match(text, /LEDGER_EXIT: \$\{\{ needs\.failure-ledger\.outputs\.exit \}\}/);
    assert.match(text, /LEDGER_UNEXPLAINED: \$\{\{ needs\.failure-ledger\.outputs\.unexplained \}\}/);
  });

  test("the digest prints a ledger section, and `did not run` rather than a blank when the job did not", () => {
    const text = wf.jobs.get('digest').lines.map((l) => l.text).join('\n');
    assert.match(text, /echo '## Failed-run ledger'/);
    assert.match(text, /echo "exit: did not run \(the failure-ledger job was \$\{LEDGER_RESULT:-not reached\}\)"/);
  });
});

describe('L7 — the register row reads this job', () => {
  const row = register.rows.find((r) => r.id === 'duty.failure-ledger');

  test('duty.failure-ledger exists, weekly, anchored at the reader', () => {
    assert.ok(row, 'tooling/ops/register.json has no duty.failure-ledger row');
    assert.equal(row.cadence, '7d');
    assert.equal(row.mechanism.anchor, 'tooling/ops/triage-failed-runs.mjs');
  });

  test("its recordQuery is the job's scheduled run history on main", () => {
    const q = row.mechanism.recordQuery;
    assert.equal(q.reader, 'github-run-history');
    assert.equal(q.workflow, 'ops-watch.yml');
    assert.deepEqual(q.unit, { jobs: [JOB] });
    assert.equal(q.event, 'schedule');
    assert.equal(q.headBranch, 'main');
  });

  test('its firstDue is a parseable instant (the bootstrap wait; deleted after the first green Monday)', () => {
    assert.ok(Number.isFinite(Date.parse(row.mechanism.recordQuery.firstDue)), row.mechanism.recordQuery.firstDue);
  });

  test("duty.workflow.ops-watch.yml's own unit does not also claim the job", () => {
    const owRow = register.rows.find((r) => r.id === 'duty.workflow.ops-watch.yml');
    assert.ok(!owRow.mechanism.recordQuery.unit.jobs.includes(JOB), JSON.stringify(owRow.mechanism.recordQuery.unit));
  });
});
