// ─────────────────────────────────────────────────────────────────────────────
// main-rows.test.mjs — tooling/ci/assert-main-rows.mjs must pass a main whose
// newest PR merge carries a `Rows:` line in its squash message, fail one whose
// does not, and refuse (exit 2) a history it cannot judge.
//
// Row: O-SQUASH-DROPS-THE-ROWS-LINE (SYN-C1).
//
// THE CASES, each with its green control on the same fixture first, so a red
// proves the mutation and not the fixture:
//   M1  the newest `(#n)` squash with `Rows: <id>` or `Rows: none — …` passes;
//       the same commit message with the line deleted exits 1 (the red control)
//   M2  the reader's regex, byte for byte: a singular `Row:` exits 1 and is named;
//       a `- **Rows:**` bullet, an indented line and a lower-case line exit 1
//   M3  the NEWEST merge is the one judged: an older merge's line does not cover
//       a newer merge without one, and a direct push on top is walked past
//   M4  COVERAGE LOST: an empty history (unborn HEAD), a bad --ref, and a history
//       with no PR merge in it each exit 2 (the red control for vacuity)
//   M5  a Renovate squash passes only through its own `Rows:` line, which
//       renovate.json prBodyNotes writes into the PR body it squashes with
//   M6  the wiring: ci.yml guard-meta runs it on push to main only, through a
//       STEP-level `if:`, with fetch-depth: 0, and ci-gate still counts skipped red.
//       The ONE job-level `if:` guard-meta may carry is #1192's draft predicate,
//       and only while ci-gate skips on it too (assert-green-means-ran A6): a
//       draft then skips both, and every other run starts both. Any other `if:`,
//       or the draft one without ci-gate's, is red (two red controls).
//
// Every repository is built with `git init` in a temp directory.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { judgeHistory, parseLog, PR_SUBJECT, ROWS_LINE } from '../assert-main-rows.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-main-rows.mjs');
const CI_YML = join(REPO, '.github', 'workflows', 'ci.yml');
const RENOVATE = join(REPO, 'renovate.json');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-main-rows-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const scratch = (name) => {
  const d = join(TMP, `${name}-${seq++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

const baseEnv = () => {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  return env;
};

const git = (where, args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8', env: baseEnv() });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout.trim();
};

/** A repository whose first-parent history is `messages`, oldest first. */
function repoWith(messages) {
  const root = scratch('repo');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  messages.forEach((m, i) => {
    writeFileSync(join(root, 'f.txt'), `${i}\n`);
    git(root, ['add', '-A']);
    const file = join(root, '..', `msg-${seq++}.txt`);
    writeFileSync(file, m);
    git(root, ['commit', '-q', '--cleanup=verbatim', '-F', file]);
  });
  return root;
}

const run = (root, extra = []) => {
  const r = spawnSync(process.execPath, [GUARD, root, ...extra], { encoding: 'utf8', env: baseEnv() });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

const OLD = 'Something earlier (#1000)\n\nRows: none — an earlier merge with its line\n';
const WITH = 'The squash keeps its Rows line (#1100)\n\n* wip\n\nRows: O-SQUASH-DROPS-THE-ROWS-LINE\n\nCo-Authored-By: x <x@example.test>\n';
const WITHOUT = WITH.replace('Rows: O-SQUASH-DROPS-THE-ROWS-LINE\n\n', '');

// ── M1 ───────────────────────────────────────────────────────────────────────
describe('M1 — the newest merge carries the line, or main is red', () => {
  test('green control: `Rows: <id>` in the newest squash exits 0 and quotes the line', () => {
    const r = run(repoWith([OLD, WITH]));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}main rows — [0-9a-f]{8} \(#1100\) carries `Rows: O-SQUASH-DROPS-THE-ROWS-LINE`/);
  });

  test('green control: `Rows: none — <reason>` passes too', () => {
    const r = run(repoWith(['Fix a typo (#7)\n\nRows: none — a README typo, no row moves\n']));
    assert.equal(r.code, 0, r.out);
  });

  test('RED CONTROL: the same message with its Rows line deleted exits 1', () => {
    assert.notEqual(WITHOUT, WITH);
    const r = run(repoWith([OLD, WITHOUT]));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL [0-9a-f]{8} \(#1100\) was squashed without a `Rows:` line/);
    assert.match(r.out, /::error title=Main's newest merge carries no Rows: line::/);
  });

  test('the subject is not read as the line', () => {
    assert.equal(judgeHistory([{ sha: 'a', subject: 'Rows: O-A (#1)', message: 'Rows: O-A (#1)' }]).code, 1);
  });
});

// ── M2 ───────────────────────────────────────────────────────────────────────
describe('M2 — the reader\'s regex, byte for byte', () => {
  const one = (body) => judgeHistory([{ sha: 'a'.repeat(40), subject: 'T (#5)', message: `T (#5)\n\n${body}` }]);

  test('green control: a bare plural line passes', () => {
    assert.equal(one('Rows: O-A\n').code, 0);
  });

  test('a singular `Row:` exits 1 and is named as singular', () => {
    const v = one('Row: O-A\n');
    assert.equal(v.code, 1);
    assert.equal(v.singular, true);
    const r = run(repoWith(['T (#5)\n\nRow: O-A\n']));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /carries only a singular `Row:` line/);
  });

  test('a bullet, a bold line, an indented line and a lower-case line are not the line', () => {
    for (const body of ['- **Rows:** O-A\n', '**Rows:** O-A\n', '  Rows: O-A\n', 'rows: O-A\n']) {
      assert.equal(one(body).code, 1, JSON.stringify(body));
    }
  });

  test('ROWS_LINE is multiline: a line deep in the body is found', () => {
    assert.ok(ROWS_LINE.test('a\nb\nRows: O-A\nc'));
    assert.ok(!ROWS_LINE.test('a Rows: O-A'));
  });
});

// ── M3 ───────────────────────────────────────────────────────────────────────
describe('M3 — the newest merge is the one judged', () => {
  test('green control: a direct push on top of a good merge is walked past', () => {
    const r = run(repoWith([WITH, 'a direct push, no PR\n']));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\(#1100\)/);
  });

  test('an older merge\'s line does not cover a newer merge without one', () => {
    const r = run(repoWith([WITH, 'Newer (#1101)\n\n* only commit messages\n']));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\(#1101\) was squashed without/);
  });

  test('--ref judges the history at that revision, not HEAD', () => {
    const root = repoWith([WITH, 'Newer (#1101)\n\nno line\n']);
    const older = git(root, ['rev-parse', 'HEAD~1']);
    assert.equal(run(root).code, 1);
    const r = run(root, ['--ref', older]);
    assert.equal(r.code, 0, r.out);
  });

  test('a subject naming a PR mid-title is not a squash subject', () => {
    assert.ok(PR_SUBJECT.test('Fix the thing (#12)'));
    assert.ok(!PR_SUBJECT.test('Revert (#12) partly'));
  });
});

// ── M4 ───────────────────────────────────────────────────────────────────────
describe('M4 — COVERAGE LOST is exit 2, never a pass', () => {
  test('RED CONTROL: an empty history (unborn HEAD) exits 2', () => {
    const root = scratch('empty');
    git(root, ['init', '-q']);
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — `git -C .* log --first-parent/);
  });

  test('a history with no PR merge in it exits 2', () => {
    const r = run(repoWith(['initial import\n', 'a direct push\n']));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — none of the 2 newest first-parent commit\(s\) has a subject naming a pull request/);
  });

  test('a ref the history does not hold exits 2', () => {
    const r = run(repoWith([WITH]), ['--ref', 'f'.repeat(40)]);
    assert.equal(r.code, 2, r.out);
  });

  test('--ref with nothing after it exits 2', () => {
    const r = run(repoWith([WITH]), ['--ref']);
    assert.equal(r.code, 2, r.out);
  });

  test('the pure verdict on no commits is 2', () => {
    assert.equal(judgeHistory([]).code, 2);
    assert.deepEqual(parseLog(''), []);
  });
});

// ── M5 ───────────────────────────────────────────────────────────────────────
describe('M5 — Renovate passes only through its own line', () => {
  const note = () => JSON.parse(readFileSync(RENOVATE, 'utf8')).prBodyNotes.find((n) => /^Rows:/.test(n));

  test('green control: a Renovate squash whose message is its PR body, with the configured note, passes', () => {
    assert.ok(note(), 'renovate.json prBodyNotes carries no Rows: line');
    const r = run(repoWith([`chore(deps): update dependency undici to v7.24.0 (#1200)\n\nThis PR contains the following updates:\n\n${note()}\n\n---\n`]));
    assert.equal(r.code, 0, r.out);
  });

  test('the same squash taking only Renovate\'s commit message (the COMMIT_MESSAGES default) exits 1', () => {
    const r = run(repoWith(['chore(deps): update dependency undici to v7.24.0 (#1200)\n\n* chore(deps): update dependency undici to v7.24.0\n']));
    assert.equal(r.code, 1, r.out);
  });
});

// ── M6 ───────────────────────────────────────────────────────────────────────
// THE DRAFT PREDICATE, byte for byte as assert-green-means-ran.mjs declares it
// (DRAFT_SKIP_IF / DRAFT_GATE_IF, ⏱ 2026-10-03, not exported: that file is a script).
const DRAFT_SKIP_IF = 'github.event.pull_request.draft != true';
const DRAFT_GATE_IF = `always() && ${DRAFT_SKIP_IF}`;
const CI_YML_REL = join('.github', 'workflows', 'ci.yml');

/** null when guard-meta's job-level `if:` is absent, or is exactly DRAFT_SKIP_IF while
 *  ci-gate's is exactly DRAFT_GATE_IF (A6's one admitted lane `if:`); else the problem. */
function guardMetaIfProblem(wf) {
  assert.ok(wf && wf.jobs.has('guard-meta') && wf.jobs.has('ci-gate'), 'ci.yml has no guard-meta or ci-gate');
  const gm = wf.jobs.get('guard-meta').jobIf?.cond ?? null;
  const gate = wf.jobs.get('ci-gate').jobIf?.cond ?? null;
  if (gm === null) return null;
  if (gm !== DRAFT_SKIP_IF) return `a job-level if: on guard-meta (\`${gm}\`) would read as skipped in ci-gate`;
  if (gate !== DRAFT_GATE_IF) return `guard-meta skips drafts but ci-gate does not skip on it (its if: is ${gate === null ? 'absent' : `\`${gate}\``})`;
  return null;
}

describe('M6 — the wiring in ci.yml', () => {
  const yml = () => readFileSync(CI_YML, 'utf8');
  const job = (src, name) => {
    const start = src.indexOf(`\n  ${name}:\n`);
    assert.ok(start > 0, `ci.yml has no job ${name}`);
    const next = src.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
    return src.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  test('guard-meta runs it in a step gated on main (a push, or its dispatch — land-next P2), with the full history', () => {
    const gm = job(yml(), 'guard-meta');
    const at = gm.indexOf('run: node tooling/ci/assert-main-rows.mjs');
    assert.ok(at > 0, 'guard-meta no longer runs assert-main-rows.mjs');
    const step = gm.slice(gm.lastIndexOf('- name:', at), at);
    assert.match(step, /if: \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\) && github\.ref == 'refs\/heads\/main'/);
    assert.match(gm, /fetch-depth: 0/);
    assert.equal(guardMetaIfProblem(parseWorkflow(REPO, CI_YML_REL)), null);
  });

  test('red controls: guard-meta gated on main, or on the draft predicate ci-gate does not share, is refused', () => {
    const src = yml();
    const gmAt = src.indexOf('\n  guard-meta:\n');
    const gateAt = src.indexOf('\n  ci-gate:\n');
    assert.ok(gmAt > 0 && gateAt > gmAt, 'ci.yml has no guard-meta before ci-gate');
    // Rewrite one job's job-level `if:` (drop whatever it carries, then insert
    // `cond` after its `runs-on:`), and judge the result with the same parser.
    const withIf = (text, name, cond) => {
      const start = text.indexOf(`\n  ${name}:\n`);
      const next = text.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
      const end = next === -1 ? text.length : start + 1 + next;
      let body = text.slice(start, end).replace(/\n {4}if:[^\n]*/, '');
      if (cond !== null) body = body.replace(/(\n {4}runs-on:[^\n]*)/, `$1\n    if: ${cond}`);
      return text.slice(0, start) + body + text.slice(end);
    };
    const judge = (text) => {
      mkdirSync(join(TMP, 'wf', '.github', 'workflows'), { recursive: true });
      writeFileSync(join(TMP, 'wf', CI_YML_REL), text);
      return guardMetaIfProblem(parseWorkflow(join(TMP, 'wf'), CI_YML_REL));
    };
    const drafted = withIf(withIf(src, 'ci-gate', DRAFT_GATE_IF), 'guard-meta', DRAFT_SKIP_IF);
    assert.equal(judge(drafted), null, 'green control: the draft pair (#1192) must pass');
    assert.equal(judge(withIf(src, 'guard-meta', null)), null, 'green control: no job-level if: must pass');
    assert.match(judge(withIf(drafted, 'guard-meta', "github.ref == 'refs/heads/main'")) ?? '', /would read as skipped/);
    assert.match(judge(withIf(drafted, 'ci-gate', 'always()')) ?? '', /ci-gate does not skip on it/);
  });

  test('ci-gate still needs guard-meta, runs always and counts skipped red', () => {
    const gate = job(yml(), 'ci-gate');
    assert.match(gate, /- guard-meta\n/);
    assert.match(gate, /if: always\(\)/);
    assert.match(gate, /contains\(needs\.\*\.result, 'skipped'\)/);
  });
});
