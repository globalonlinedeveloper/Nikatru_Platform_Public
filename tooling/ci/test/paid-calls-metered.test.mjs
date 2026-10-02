// ─────────────────────────────────────────────────────────────────────────────
// paid-calls-metered.test.mjs — assert-paid-calls-metered.mjs (T17).
//
// Fixture trees, each one input the guard must red (or green). The mutation of
// the REAL tree — deleting the adapter's reservation call — was run by hand on
// 2026-10-02 and exited 1 naming the P2 anchor; the first case below is the
// green control on the real tree.
//
// Run:  node --test tooling/ci/test/paid-calls-metered.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-paid-calls-metered.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-paid-calls-'));
});
after(() => rmSync(TMP, { recursive: true, force: true }));

const write = (root, relPath, body) => {
  const p = join(root, ...relPath.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};
const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });

const ADAPTER = "import x from '@anthropic-ai/sdk';\nconst r = await reserveOrRefuse(C, deps.beforeCall, req, lim);\n";
const METER = 'export async function planOf(a) {}\nconst beforeCall = async () => {};\n';
const ROUTE = "const c = { source: 'ai_import' };\n";
const ARB = JSON.stringify({ aiDisclosureBody: 'x', '@aiDisclosureBody': {}, aiCandidateLabel: 'y' });

function row(over = {}) {
  return {
    id: 'anthropic-metered',
    host: 'api.anthropic.com',
    kind: 'ai-inference',
    payer: 'customer',
    mode: 'metered',
    callers: ['services/a/adapter.ts'],
    gate: [
      { file: 'services/a/adapter.ts', anchor: 'reserveOrRefuse(C, deps.beforeCall', why: 'the reservation' },
      { file: 'services/a/meter.ts', anchor: 'export async function planOf(', why: 'the plan check' },
    ],
    disclosure: { arb: 'packages/l10n/en.arb', keys: ['aiDisclosureBody', 'aiCandidateLabel'] },
    marker: [{ file: 'services/a/route.ts', field: "source: 'ai_import'" }],
    ...over,
  };
}

function tree({ rows = [row()], files = {}, register = undefined } = {}) {
  const root = join(TMP, `t${++seq}`);
  write(root, 'services/a/adapter.ts', ADAPTER);
  write(root, 'services/a/meter.ts', METER);
  write(root, 'services/a/route.ts', ROUTE);
  write(root, 'packages/l10n/en.arb', ARB);
  for (const [p, b] of Object.entries(files)) write(root, p, b);
  write(
    root,
    'tooling/paid-calls.json',
    register ?? JSON.stringify({ scanRoots: ['services', 'packages'], hosts: { 'api.anthropic.com': ['api.anthropic.com', '@anthropic-ai/sdk'] }, rows }),
  );
  return root;
}

describe('assert-paid-calls-metered', () => {
  test('the real tree is green (the control for the mutation recorded above)', () => {
    const r = run(REPO);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /every one customer-paid, gated, disclosed and marked/);
  });

  test('a complete fixture is green', () => {
    const r = run(tree());
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('🔴 removing the gate anchor (the reservation call) exits 1', () => {
    const r = run(tree({ files: { 'services/a/adapter.ts': "import x from '@anthropic-ai/sdk';\nconst r = await call(req);\n" } }));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /P2 gate anchor .*reserveOrRefuse.* is gone from services\/a\/adapter\.ts/);
  });

  test('🔴 a metered row with only one gate exits 1: the plan check is not optional', () => {
    const r = run(tree({ rows: [row({ gate: [row().gate[0]] })] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /needs at least 2 gate anchor/);
  });

  test('🔴 payer other than customer exits 1 — no AI on a path we pay for', () => {
    const r = run(tree({ rows: [row({ payer: 'us' })] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /payer is "us"/);
  });

  test('🔴 an ai-inference row with NO disclosure key exits 1 (Art. 50(1))', () => {
    const r = run(tree({ rows: [row({ disclosure: undefined })] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /names its disclosure/);
  });

  test('🔴 a disclosure key the ARB does not hold exits 1, and an @-metadata key is not a string', () => {
    let r = run(tree({ rows: [row({ disclosure: { arb: 'packages/l10n/en.arb', keys: ['aiNoSuchKey'] } })] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /"aiNoSuchKey" does not exist/);
    r = run(tree({ rows: [row({ disclosure: { arb: 'packages/l10n/en.arb', keys: ['@aiDisclosureBody'] } })] }));
    assert.equal(r.status, 1);
  });

  test('🔴 an ai-inference row with no marker, or a marker gone from its file, exits 1 (Art. 50(2))', () => {
    let r = run(tree({ rows: [row({ marker: [] })] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /output marker/);
    r = run(tree({ files: { 'services/a/route.ts': 'const c = {};\n' } }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /marker "source: 'ai_import'" is not in/);
  });

  test('🔴 a NEW caller with no row exits 1 (coverage), and a test file is not a caller', () => {
    let r = run(tree({ files: { 'packages/x/lib/new_call.dart': "final u = 'https://api.anthropic.com/v1/messages';\n" } }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /P4 packages\/x\/lib\/new_call\.dart names api\.anthropic\.com/);
    r = run(tree({ files: { 'packages/x/test/call_test.dart': "final u = 'https://api.anthropic.com';\n", 'services/a/x.test.ts': "'@anthropic-ai/sdk'" } }));
    assert.equal(r.status, 0, r.stderr);
  });

  test('a Windows-style caller path (backslashes, ./) in the register resolves to the same file', () => {
    const r = run(tree({ rows: [row({ callers: ['.\\services\\a\\adapter.ts'], gate: [{ file: 'services\\a\\adapter.ts', anchor: 'reserveOrRefuse(C, deps.beforeCall', why: 'w' }, row().gate[1]] })] }));
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('COVERAGE LOST (exit 2): no register, no rows, or a scan that sees no caller', () => {
    const empty = join(TMP, `t${++seq}`);
    mkdirSync(empty, { recursive: true });
    assert.equal(run(empty).status, 2);
    assert.equal(run(tree({ rows: [] })).status, 2);
    const none = tree({ files: { 'services/a/adapter.ts': 'const r = reserveOrRefuse(C, deps.beforeCall, req);\n' } });
    const r = run(none);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /COVERAGE LOST/);
  });
});
