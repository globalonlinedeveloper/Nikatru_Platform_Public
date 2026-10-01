// check-secret-scopes.test.mjs — tooling/ops/check-secret-scopes.mjs reads GitHub's secret NAMES
// per scope back against the register (train P17). Every case drives the REAL script over a
// fixture register and a --names-file, so nothing reaches the network. The red control is the
// brief's: MS_STORE_CLIENT_SECRET listed at BOTH scopes exits 1.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MOVE_BY, flipText } from '../../ops/check-secret-scopes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, '..', '..', 'ops', 'check-secret-scopes.mjs');

const row = (storedAt, extra = {}) => ({
  name: 'MS_STORE_CLIENT_SECRET', kind: 'publishing-credential', productionData: 'none', why: 'fixture store credential',
  environment: 'store-publish', storedAt, ...(storedAt === 'repository' ? { moveStep: 'OWNER: gh secret set --env store-publish, then delete the repository copy' } : {}), ...extra,
});
function fixture({ rows = [row('environment')], names, workflowSecrets = ['MS_STORE_CLIENT_SECRET'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'secret-scopes-'));
  const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  w('tooling/channel-register.json', `${JSON.stringify({ ciSecretRegister: { nonSigning: rows } }, null, 2)}\n`);
  w('.github/workflows/submit.yml', ['name: s', 'on: workflow_dispatch', 'jobs:', '  submit:', '    runs-on: ubuntu-24.04', '    environment: store-publish', '    steps:', '      - env:', ...workflowSecrets.map((n) => `          ${n}: \${{ secrets.${n} }}`), '        # a comment naming secrets.NOT_A_REFERENCE and worker-secrets.json', '        run: echo', ''].join('\n'));
  const namesFile = join(root, 'names.json');
  writeFileSync(namesFile, JSON.stringify(names ?? { repository: [], environments: { 'store-publish': ['MS_STORE_CLIENT_SECRET'] } }));
  return { root, namesFile };
}
const run = ({ root, namesFile }, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [TOOL, '--root', root, ...(namesFile ? ['--names-file', namesFile] : []), ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('check-secret-scopes — the names, read back against the register', () => {
  it('GREEN CONTROL: a row stored in its environment only passes, and the banner says FIXTURE', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /FIXTURE NAMES/);
    assert.match(r.out, /check-secret-scopes: clean/);
  });
  it('🔴 RED CONTROL: MS_STORE_CLIENT_SECRET at BOTH scopes, its row saying "environment", exits 1', () => {
    const r = run(fixture({ names: { repository: ['MS_STORE_CLIENT_SECRET'], environments: { 'store-publish': ['MS_STORE_CLIENT_SECRET'] } } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL {2}MS_STORE_CLIENT_SECRET: the register says it is stored in store-publish, and a REPOSITORY-level copy exists/);
  });
  it(`a "repository" row with a moveStep PRINTS as pending until ${MOVE_BY}, and FAILS the day after (#1095's rule)`, () => {
    const f = fixture({ rows: [row('repository')], names: { repository: ['MS_STORE_CLIENT_SECRET'], environments: {} } });
    const before = run(f, ['--today', MOVE_BY]);
    assert.equal(before.code, 0, before.out);
    assert.match(before.out, /PENDING MOVE {2}MS_STORE_CLIENT_SECRET/);
    const after = run(f, ['--today', '2026-12-01']);
    assert.equal(after.code, 1, after.out);
    assert.match(after.out, /still stored at REPOSITORY level after the move date 2026-11-30/);
  });
  it('🔴 a scoped secret stored NOWHERE exits 1', () => {
    const r = run(fixture({ names: { repository: [], environments: { 'store-publish': [] } } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /stored NOWHERE/);
  });
  it('prints stored-but-unreferenced (security-022) and referenced-but-unstored names; prose is not a reference', () => {
    const r = run(fixture({ workflowSecrets: ['MS_STORE_CLIENT_SECRET', 'NOT_MINTED_YET'], names: { repository: ['OLD_UNUSED'], environments: { 'store-publish': ['MS_STORE_CLIENT_SECRET'] } } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /STORED, REFERENCED BY NO WORKFLOW .*: OLD_UNUSED/);
    assert.match(r.out, /REFERENCED, STORED NOWHERE .*: NOT_MINTED_YET$/m);
    assert.doesNotMatch(r.out, /NOT_A_REFERENCE|json/);
  });
  it('--write-flips rewrites a DONE move to storedAt "environment" and drops its moveStep, leaving valid JSON', () => {
    const f = fixture({ rows: [row('repository')] });
    const r = run(f, ['--write-flips']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /MOVE DONE {5}MS_STORE_CLIENT_SECRET/);
    assert.match(r.out, /--write-flips: MS_STORE_CLIENT_SECRET rewritten/);
    const doc = JSON.parse(readFileSync(join(f.root, 'tooling/channel-register.json'), 'utf8'));
    assert.equal(doc.ciSecretRegister.nonSigning[0].storedAt, 'environment');
    assert.equal(doc.ciSecretRegister.nonSigning[0].moveStep, undefined);
    assert.equal(doc.ciSecretRegister.nonSigning[0].why, 'fixture store credential', 'nothing else moved');
  });
  it('flipText touches only the named row', () => {
    // Any indentation, and a brace inside a string, must not move the row's end.
    const text = JSON.stringify({ a: [{ name: 'A', storedAt: 'repository', moveStep: 'x' }, { name: 'B', storedAt: 'repository', moveStep: 'y { } "z"' }] }, null, 3);
    const { text: out, flipped } = flipText(text, ['B']);
    assert.deepEqual(flipped, ['B']);
    const doc = JSON.parse(out);
    assert.deepEqual([doc.a[0].storedAt, doc.a[0].moveStep, doc.a[1].storedAt, doc.a[1].moveStep], ['repository', 'x', 'environment', undefined]);
  });
  it('🔴 no token: COVERAGE LOST (exit 2); inside --unreadable-until a warning and exit 0; past it, exit 2', () => {
    const f = { root: fixture().root, namesFile: null };
    const env = { GH_TOKEN: '', GITHUB_TOKEN: '' };
    assert.equal(run(f, [], env).code, 2);
    const inside = run(f, ['--unreadable-until', '2099-01-01'], env);
    assert.equal(inside.code, 0, inside.out);
    assert.match(inside.out, /::warning title=Secret scopes NOT READ \(unreadable until 2099-01-01\)::/);
    assert.equal(run(f, ['--unreadable-until', '2020-01-01'], env).code, 2);
  });
});
