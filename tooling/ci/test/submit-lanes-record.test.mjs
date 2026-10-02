// ─────────────────────────────────────────────────────────────────────────────
// submit-lanes-record.test.mjs — EVERY RUN OF A SUBMIT LANE IS RECORDED, WITH ITS
// MODE, IN THE REAL TREE. ⏱ 2026-09-26 (O-SUBMISSION-LANE-WITHOUT-RECORDER, and the
// guard limb of O-APPLE-SUBMISSION-UNRECORDED).
//
// The lanes are DERIVED, never listed: `check-prod-provenance.mjs
// --emit-release-lanes` is the function the provenance reader uses to find where
// a submitted build's witness lives, so a lane it reads and a lane this test
// grades cannot be two lists. For each `submission` lane, every step that runs a
// `tooling/release/submit-*.mjs` script must be followed, in the SAME job, by a
// step that runs `record-deployment.mjs` straight from its shell (so the run
// identity reaches it), with a literal `--mode` matching the invocation:
// `--mode dry-run` after `--dry-run`, `--mode production` after anything else.
//
// A zero-lane result is a failure, not a pass: a grader over nothing prints
// exactly what a grader that passed prints. ci.yml runs the same scripts'
// `--dry-run` on every push; those are script tests, not lanes, and the emit
// does not list it (one case below holds that).
//
// assert-publish-records.mjs rules 2 and 3a-3c grade the same property from the
// register's submittable rows; this test grades it from the provenance reader's
// lanes, so a lane either side stops seeing is still caught by the other.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, workflowSteps, shellSegments } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MONITOR = join(ROOT, 'tooling', 'ops', 'check-prod-provenance.mjs');
const SUBMIT_SCRIPT = /(?:^|\s)node\s+(?:\.\/)?tooling\/release\/(submit-[a-z0-9-]+\.mjs)(?=\s|$)/;
const RECORD_STEP = /^node\s+tooling\/ci\/record-deployment\.mjs\s/;
const CONTEXT = { GITHUB_WORKFLOW_REF: 'workflow_ref', GITHUB_RUN_ID: 'run_id', GITHUB_RUN_ATTEMPT: 'run_attempt', GITHUB_RUN_NUMBER: 'run_number' };

/** The release lanes, as the provenance reader derives them. */
function releaseLanes() {
  const r = spawnSync(process.execPath, [MONITOR, '--emit-release-lanes'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `--emit-release-lanes exited ${r.status}: ${r.stdout}${r.stderr}`);
  return r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [workflow, kind, environments] = l.split('\t');
      return { workflow, kind, environments: environments.split(',') };
    });
}

/** The literal `--mode` of one record segment, or null when absent or not a literal. */
function literalMode(segment) {
  const raw = (segment.match(/--mode\s+(\S+)/) ?? [])[1] ?? null;
  if (raw === null) return null;
  const v = raw.replace(/^(['"])(.*)\1$/, '$2');
  return ['production', 'dry-run'].includes(v) ? v : null;
}

/** Why a record step would NOT carry the runner's run identity, or null. */
function identityBlocker(step) {
  for (const [key, entry] of step.env) {
    if (!(key in CONTEXT)) continue;
    const value = typeof entry === 'string' ? entry : entry?.value;
    if (String(value ?? '').trim() !== `\${{ github.${CONTEXT[key]} }}`) return `its env sets ${key}`;
  }
  return null;
}

/** Every finding for the submission lanes named, read from `root`. */
function gradeLanes(root, workflows) {
  if (workflows.length === 0) {
    return { findings: ['ZERO submission lanes were derived — this grader would range over nothing (COVERAGE LOST)'], invocations: 0, recorded: 0 };
  }
  const findings = [];
  let invocations = 0;
  let recorded = 0;
  for (const file of workflows) {
    const wf = parseWorkflow(root, `.github/workflows/${file}`);
    let laneInvocations = 0;
    for (const [jobName, job] of wf.jobs) {
      const steps = workflowSteps(job);
      steps.forEach((step, i) => {
        const segment = shellSegments(step.run?.text ?? '').find((s) => SUBMIT_SCRIPT.test(s));
        if (!segment) return;
        laneInvocations += 1;
        invocations += 1;
        const script = segment.match(SUBMIT_SCRIPT)[1];
        const want = /(^|\s)--dry-run(\s|$)/.test(segment) ? 'dry-run' : 'production';
        const later = steps.slice(i + 1).flatMap((s) =>
          shellSegments(s.run?.text ?? '')
            .map((seg) => seg.trim())
            .filter((seg) => RECORD_STEP.test(seg))
            .map((seg) => ({ step: s, seg })),
        );
        if (!later.some(({ seg }) => literalMode(seg) === want)) {
          findings.push(
            `${file} job "${jobName}" step "${step.name ?? step.index + 1}" runs ${script} (${want === 'dry-run' ? '--dry-run' : 'a real submission'}) ` +
              `and no later step in the job records it with a literal \`--mode ${want}\`` +
              `${later.length ? ` (later record calls: ${later.map(({ seg }) => `\`${seg}\``).join(', ')})` : ''}`,
          );
          return;
        }
        recorded += 1;
      });
      // Every record step in a lane carries the runner's identity — not just the first one found.
      for (const s of steps) {
        if (!shellSegments(s.run?.text ?? '').some((seg) => RECORD_STEP.test(seg.trim()))) continue;
        const blocked = identityBlocker(s);
        if (blocked) findings.push(`${file} job "${jobName}": the record step "${s.name ?? s.index + 1}" cannot carry the run identity: ${blocked}`);
      }
    }
    if (laneInvocations === 0) findings.push(`${file} is a submission lane and no step in it runs a tooling/release/submit-*.mjs script — the parse stopped seeing it`);
  }
  return { findings, invocations, recorded };
}

describe('submit lanes — every run is recorded, with its mode (the REAL tree)', () => {
  test('the submission lanes come from --emit-release-lanes, and there is at least one', () => {
    const lanes = releaseLanes().filter((l) => l.kind === 'submission');
    assert.ok(lanes.length > 0, 'the provenance reader derived ZERO submission lanes');
    assert.ok(lanes.some((l) => l.workflow === 'submit-appstore.yml'), 'submit-appstore.yml records, and is never declared dry-run-only');
  });

  test('every submit-*.mjs step in every submission lane is followed by a record of its own mode, with the run identity', () => {
    const lanes = releaseLanes().filter((l) => l.kind === 'submission').map((l) => l.workflow);
    const { findings, invocations, recorded } = gradeLanes(ROOT, lanes);
    assert.deepEqual(findings, []);
    assert.ok(invocations >= lanes.length, `graded ${invocations} invocation(s) over ${lanes.length} lane(s)`);
    assert.equal(recorded, invocations);
  });

  // ⏱ 2026-10-01: the dry runs (app-dryrun) run in lane-apps.yml, ci.yml's apps lane callee (ADR 095).
  test('lane-apps.yml runs the submit scripts\' dry runs and is NOT a lane — it is not counted', () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'lane-apps.yml'), 'utf8');
    assert.match(ci, /node tooling\/release\/submit-[a-z-]+\.mjs --dry-run/, 'lane-apps.yml no longer runs a submit script — this case would hold nothing');
    const lanes = releaseLanes().map((l) => l.workflow);
    assert.ok(!lanes.includes('ci.yml') && !lanes.includes('lane-apps.yml'), `ci.yml or lane-apps.yml is listed as a release lane: ${lanes.join(', ')}`);
  });

  test('a ZERO-lane result is a finding, not a pass', () => {
    const { findings } = gradeLanes(ROOT, []);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /ZERO submission lanes/);
  });

  test('RC1 (the row\'s red control): the recorder step deleted from submit-play.yml in a tmpdir copy fails, naming the file and the job', () => {
    const lanes = releaseLanes().filter((l) => l.kind === 'submission').map((l) => l.workflow);
    const root = mkdtempSync(join(tmpdir(), 'nikatru-submit-lanes-record-'));
    try {
      cpSync(join(ROOT, '.github'), join(root, '.github'), { recursive: true });
      assert.deepEqual(gradeLanes(root, lanes).findings, [], 'GREEN CONTROL: the unmutated copy passes');
      const rel = join(root, '.github', 'workflows', 'submit-play.yml');
      const text = readFileSync(rel, 'utf8');
      const step = /\n {6}- name: Record the submission in the \[10\]D-9 ledger\n(?: {8}.*\n)+/;
      assert.match(text, step, 'the Play submit job\'s record step is not where this control expects it');
      writeFileSync(rel, text.replace(step, '\n'));
      const { findings } = gradeLanes(root, lanes);
      assert.equal(findings.length, 1, findings.join('\n'));
      assert.match(findings[0], /^submit-play\.yml job "submit" step "Upload to Google Play" runs submit-play\.mjs \(a real submission\) and no later step in the job records it/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a dry-run step whose record says --mode production is a finding — the mode must match the run', () => {
    const lanes = releaseLanes().filter((l) => l.kind === 'submission').map((l) => l.workflow);
    const root = mkdtempSync(join(tmpdir(), 'nikatru-submit-lanes-record-'));
    try {
      cpSync(join(ROOT, '.github'), join(root, '.github'), { recursive: true });
      const rel = join(root, '.github', 'workflows', 'submit-snap.yml');
      const text = readFileSync(rel, 'utf8');
      const line = 'node tooling/ci/record-deployment.mjs "${APP}-linux-snap" --mode dry-run';
      assert.ok(text.includes(line), 'the snap dry-run record is not where this case expects it');
      writeFileSync(rel, text.replace(line, 'node tooling/ci/record-deployment.mjs "${APP}-linux-snap" --mode production'));
      const { findings } = gradeLanes(root, lanes);
      assert.equal(findings.length, 1, findings.join('\n'));
      assert.match(findings[0], /^submit-snap\.yml job "dry-run" .* runs submit-snap\.mjs \(--dry-run\) and no later step in the job records it with a literal `--mode dry-run`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a record step that sets a run-identity variable of its own is a finding', () => {
    const lanes = releaseLanes().filter((l) => l.kind === 'submission').map((l) => l.workflow);
    const root = mkdtempSync(join(tmpdir(), 'nikatru-submit-lanes-record-'));
    try {
      cpSync(join(ROOT, '.github'), join(root, '.github'), { recursive: true });
      const rel = join(root, '.github', 'workflows', 'submit-appstore.yml');
      const text = readFileSync(rel, 'utf8');
      const anchor = '      - name: Record the iOS dry run in the [10]D-9 ledger (mode dry-run)\n        env:\n';
      assert.ok(text.includes(anchor), 'the App Store iOS record step is not where this case expects it');
      writeFileSync(rel, text.replace(anchor, `${anchor}          GITHUB_RUN_ID: '1'\n`));
      const { findings } = gradeLanes(root, lanes);
      assert.equal(findings.length, 1, findings.join('\n'));
      assert.match(findings[0], /^submit-appstore\.yml job "dry-run": the record step "Record the iOS dry run .*" cannot carry the run identity: its env sets GITHUB_RUN_ID/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
