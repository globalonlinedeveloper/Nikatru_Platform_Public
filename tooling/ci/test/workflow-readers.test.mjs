// ─────────────────────────────────────────────────────────────────────────────
// workflow-readers.test.mjs — assert-workflow-readers.mjs must be able to FAIL on
// each limb, must not mistake a message or a path prefix for a read, and must
// refuse when it detects nothing.
//
// Register row O-LOCAL-SCRIPTS-PARSE-MOVED-WORKFLOWS.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-workflow-readers.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-wfreaders-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const SCAN_READER =
  "import { parseWorkflow } from '../ci/workflow-scan.mjs';\n" +
  "const gate = parseWorkflow(ROOT, '.github/workflows/ci.yml');\n";
const BLIND_READER =
  "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\n" +
  "const dir = join(ROOT, '.github', 'workflows');\n" +
  "if (!found) { console.error('COVERAGE LOST — the concurrency block this reads is gone'); process.exit(2); }\n";

const baseRegister = () => ({
  readers: [
    { path: 'tooling/scripts/gen.mjs', property: 'workflow-scan' },
    { path: 'tooling/ops/rerun.mjs', property: 'refuses-blind', evidence: 'the concurrency block this reads is gone' },
    { path: 'tooling/ci/assert-something.mjs', property: 'refuses-blind', evidence: 'no workflow file was read at all here' },
  ],
});
const CI_READER =
  "const p = join(ROOT, '.github', 'workflows');\n" +
  "if (!n) { console.error('COVERAGE LOST — no workflow file was read at all here'); process.exit(2); }\n";

function fixture({ files = {}, register = baseRegister() } = {}) {
  const dir = join(TMP, `r${seq++}`);
  const all = {
    'tooling/scripts/gen.mjs': SCAN_READER,
    'tooling/ops/rerun.mjs': BLIND_READER,
    'tooling/scripts/plain.mjs': "console.log('Dispatch .github/workflows/submit-play.yml instead.');\n",
    'extensions/scripts/discover.mjs': "const TOUCHES = ['core/', '.github/workflows/', 'contracts/'];\n",
    'tooling/ci/assert-something.mjs': CI_READER,
    'tooling/ci/workflow-scan.mjs': "export const WORKFLOW_DIR = '.github/workflows';\n",
    'tooling/ci/test/something.test.mjs': "const p = join(dir, '.github', 'workflows');\n",
    'tooling/scripts/test/helper.test.mjs': "const p = '.github/workflows/ci.yml';\n",
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    if (body === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  if (register !== null) writeFileSync(join(dir, 'tooling/workflow-readers.json'), JSON.stringify(register, null, 2));
  return dir;
}
const run = (dir) => {
  const r = spawnSync(process.execPath, [GUARD, dir], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-workflow-readers', () => {
  test('passes: three declared readers; a message, a path PREFIX, workflow-scan.mjs itself and test files are not readers', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}workflow readers — 3 reader\(s\) \(1 in tooling\/ci\/\) in \d+ code file\(s\) outside \.github\/: 1 workflow-scan · 2 refuses-blind/);
  });

  test('R1: a tooling/ci guard that reads a workflow by text with no row fails (2026-09-15, the domain widened)', () => {
    const { code, out } = run(fixture({ files: { 'tooling/ci/assert-new.mjs': "const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');\n" } }));
    assert.equal(code, 1, out);
    assert.match(out, /R1 tooling\/ci\/assert-new\.mjs reads a workflow by text and has no row/);
  });

  test('R3: a tooling/ci refuses-blind row whose refusal was removed fails', () => {
    const { code, out } = run(fixture({ files: { 'tooling/ci/assert-something.mjs': "const p = join(ROOT, '.github', 'workflows');\n" } }));
    assert.equal(code, 1, out);
    assert.match(out, /R3 tooling\/ci\/assert-something\.mjs is declared `refuses-blind` and its evidence text is not in the file/);
  });

  test('COVERAGE LOST: tooling/ci/ exists and the detector finds no reader in it', () => {
    const reg = baseRegister();
    reg.readers = reg.readers.filter((r) => !r.path.startsWith('tooling/ci/'));
    const { code, out } = run(fixture({ files: { 'tooling/ci/assert-something.mjs': "console.log('z');\n" }, register: reg }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/ci\/ exists and the detector found ZERO workflow readers in it/);
  });

  test('R1: a new script that reads a workflow file by text with no row fails', () => {
    const { code, out } = run(fixture({ files: { 'tooling/scripts/skew.mjs': "const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');\n" } }));
    assert.equal(code, 1, out);
    assert.match(out, /R1 tooling\/scripts\/skew\.mjs reads a workflow by text and has no row/);
  });

  test('R1: a `.github`, `workflows` join is detected too', () => {
    const { code, out } = run(fixture({ files: { 'tooling/release/lane.mjs': "const d = path.join(base, '.github', 'workflows', name);\n" } }));
    assert.equal(code, 1, out);
    assert.match(out, /R1 tooling\/release\/lane\.mjs reads a workflow by text/);
  });

  test('R1: a row with an unknown property fails', () => {
    const reg = baseRegister();
    reg.readers[0].property = 'trusted';
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /R1 tooling\/scripts\/gen\.mjs — property "trusted" is not one of workflow-scan, refuses-blind/);
  });

  test('R2: a workflow-scan row whose file stopped importing workflow-scan.mjs fails', () => {
    const { code, out } = run(fixture({ files: { 'tooling/scripts/gen.mjs': "const gate = parseWorkflow(ROOT, '.github/workflows/ci.yml');\n" } }));
    assert.equal(code, 1, out);
    assert.match(out, /R2 tooling\/scripts\/gen\.mjs is declared `workflow-scan` and does not import/);
  });

  test('R2: an import that survives only inside a comment does not count', () => {
    const { code, out } = run(fixture({ files: { 'tooling/scripts/gen.mjs': "// import { parseWorkflow } from '../ci/workflow-scan.mjs';\nconst gate = parse('.github/workflows/ci.yml');\n" } }));
    assert.equal(code, 1, out);
    assert.match(out, /R2 tooling\/scripts\/gen\.mjs/);
  });

  test('R3: a refuses-blind row whose refusal text was removed fails', () => {
    const { code, out } = run(fixture({ files: { 'tooling/ops/rerun.mjs': BLIND_READER.replace('the concurrency block this reads is gone', 'nothing to do') } }));
    assert.equal(code, 1, out);
    assert.match(out, /R3 tooling\/ops\/rerun\.mjs is declared `refuses-blind` and its evidence text is not in the file/);
  });

  test('R3: a refuses-blind row with no real evidence fails', () => {
    const reg = baseRegister();
    reg.readers[1].evidence = 'gone';
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /R3 tooling\/ops\/rerun\.mjs is declared `refuses-blind` with no `evidence` of at least 20 characters/);
  });

  test('R4: a row for a file that no longer reads a workflow, and one for a file that is gone, both fail', () => {
    const reg = baseRegister();
    reg.readers.push({ path: 'tooling/scripts/plain.mjs', property: 'workflow-scan' });
    reg.readers.push({ path: 'tooling/scripts/gone.mjs', property: 'workflow-scan' });
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /R4 tooling\/workflow-readers\.json declares tooling\/scripts\/plain\.mjs, which no longer reads a workflow by text/);
    assert.match(out, /R4 tooling\/workflow-readers\.json declares tooling\/scripts\/gone\.mjs, which does not exist/);
  });

  test('COVERAGE LOST: no register', () => {
    const { code, out } = run(fixture({ register: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/workflow-readers\.json does not exist/);
  });

  test('COVERAGE LOST: a tree where the detector finds no reader at all', () => {
    const { code, out } = run(fixture({ files: { 'tooling/scripts/gen.mjs': "console.log('x');\n", 'tooling/ops/rerun.mjs': "console.log('y');\n", 'tooling/ci/assert-something.mjs': "console.log('z');\n" }, register: { readers: [] } }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — read \d+ code file\(s\) and detected ZERO workflow readers/);
  });
});

// ── R5 · ⏱ 2026-09-24 · P-A2 · `resolves: "local-uses"` is checked against the code ──
// O-GUARDS-DO-NOT-FOLLOW-LOCAL-USES. Each case below is written out by hand.
describe('assert-workflow-readers — R5, a row that declares it resolves local `uses:`', () => {
  test('passes: a workflow-scan row whose file calls parseResolvedWorkflows(', () => {
    const reg = baseRegister();
    reg.readers[0].resolves = 'local-uses';
    const { code, out } = run(fixture({ files: { 'tooling/scripts/gen.mjs': `${SCAN_READER}const all = parseResolvedWorkflows(ROOT);\n` }, register: reg }));
    assert.equal(code, 0, out);
    assert.match(out, /R5 — 1 row\(s\) declare `resolves: "local-uses"`/);
  });

  test('passes: a row whose file lists .github/actions itself', () => {
    const reg = baseRegister();
    reg.readers[2].resolves = 'local-uses';
    const { code, out } = run(fixture({ files: { 'tooling/ci/assert-something.mjs': `${CI_READER}const actions = join(ROOT, '.github', 'actions');\n` }, register: reg }));
    assert.equal(code, 0, out);
    assert.match(out, /R5 — 1 row\(s\) declare/);
  });

  test('R5: a row declared to resolve local uses whose file reads one workflow at a time fails', () => {
    const reg = baseRegister();
    reg.readers[0].resolves = 'local-uses';
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /R5 tooling\/scripts\/gen\.mjs is declared `resolves: "local-uses"` and its code neither calls parseResolvedWorkflows\( nor lists \.github\/actions/);
  });

  test('R5: a parseResolvedWorkflows( call that survives only inside a comment does not count', () => {
    const reg = baseRegister();
    reg.readers[0].resolves = 'local-uses';
    const { code, out } = run(fixture({ files: { 'tooling/scripts/gen.mjs': `${SCAN_READER}// const all = parseResolvedWorkflows(ROOT);\n` }, register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /R5 tooling\/scripts\/gen\.mjs is declared `resolves: "local-uses"`/);
  });

  test('R5: an unknown resolves value fails', () => {
    const reg = baseRegister();
    reg.readers[0].resolves = 'everything';
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /R5 tooling\/scripts\/gen\.mjs — resolves "everything" is not one of local-uses/);
  });
});
