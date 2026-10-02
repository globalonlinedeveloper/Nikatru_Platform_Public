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
import { MOVE_BY, FIRST_DUE_MAX_DAYS, flipText, readNames, nextLink } from '../../ops/check-secret-scopes.mjs';

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

// ⏱ 2026-10-02 · #1135 review finding 2: a scoped secret declared before its channel exists is
// KNOWN FAILING, NOT YET DUE until its row's `firstDue`, bounded, then it blocks (ops-register's pattern).
describe('check-secret-scopes — a dated pending state for a secret not minted yet', () => {
  const nowhere = { repository: [], environments: { 'store-publish': [] } };
  it('before firstDue: stored nowhere PRINTS as NOT YET DUE and does not block (exit 0)', () => {
    const r = run(fixture({ rows: [row('environment', { firstDue: '2026-11-30' })], names: nowhere }), ['--today', '2026-10-02']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NOT YET DUE {3}MS_STORE_CLIENT_SECRET: scoped to store-publish and stored NOWHERE.*KNOWN FAILING, NOT YET DUE: firstDue is 2026-11-30, 59 day\(s\) from now/);
  });
  it('🔴 on and after firstDue it BLOCKS (exit 1), saying the date has passed', () => {
    for (const today of ['2026-11-30', '2026-12-15']) {
      const r = run(fixture({ rows: [row('environment', { firstDue: '2026-11-30' })], names: nowhere }), ['--today', today]);
      assert.equal(r.code, 1, `${today}\n${r.out}`);
      assert.match(r.out, /FAIL {2}MS_STORE_CLIENT_SECRET: .*stored NOWHERE.*its firstDue 2026-11-30 has PASSED, so it gates nothing/);
    }
  });
  it(`🔴 a firstDue more than ${FIRST_DUE_MAX_DAYS} days ahead, or not a date, gates nothing (exit 1): never an open-ended waiver`, () => {
    for (const firstDue of ['2027-06-01', 'someday']) {
      const r = run(fixture({ rows: [row('environment', { firstDue })], names: nowhere }), ['--today', '2026-10-02']);
      assert.equal(r.code, 1, `${firstDue}\n${r.out}`);
      assert.match(r.out, /gates nothing|past the 92-day bound/);
    }
  });
  it('🔴 firstDue never excuses a REPOSITORY-level copy of an environment-stored secret', () => {
    const r = run(fixture({ rows: [row('environment', { firstDue: '2026-11-30' })], names: { repository: ['MS_STORE_CLIENT_SECRET'], environments: { 'store-publish': ['MS_STORE_CLIENT_SECRET'] } } }), ['--today', '2026-10-02']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a REPOSITORY-level copy exists/);
  });
});

// ⏱ 2026-10-02 · #1135 review finding 3: each listing read one page of 100 names.
describe('check-secret-scopes — every page of every listing', () => {
  /** A fake GitHub serving `names` 100 a page with Link: rel="next", and one environment. */
  const fakeGitHub = (names, { totalCount = names.length } = {}) => async (url) => {
    const u = new URL(url);
    const json = (body, link) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...(link ? { link } : {}) } });
    if (u.pathname.endsWith('/environments')) return json({ total_count: 1, environments: [{ name: 'store-publish' }] });
    if (u.pathname.includes('/environments/')) return json({ total_count: 1, secrets: [{ name: 'ENV_ONLY' }] });
    const page = Number(u.searchParams.get('page') ?? 1);
    const slice = names.slice((page - 1) * 100, page * 100);
    const more = page * 100 < names.length;
    return json({ total_count: totalCount, secrets: slice.map((name) => ({ name })) }, more ? `<https://api.github.com/repos/o/r/actions/secrets?per_page=100&page=${page + 1}>; rel="next", <https://api.github.com/repos/o/r/actions/secrets?per_page=100&page=3>; rel="last"` : null);
  };
  const names = Array.from({ length: 230 }, (_, i) => `SECRET_${String(i).padStart(3, '0')}`);
  it('🔴 230 repository names over three pages are ALL read: a name on page 3 is seen', async () => {
    const r = await readNames({ repo: 'o/r', token: 't', fetchImpl: fakeGitHub(names) });
    assert.equal(r.repository.size, 230);
    assert.ok(r.repository.has('SECRET_229'), 'a name past page 1 was not read');
    assert.deepEqual([...r.environments.get('store-publish')], ['ENV_ONLY']);
  });
  it('🔴 pages that do not add up to total_count are refused, never graded as a full listing', async () => {
    await assert.rejects(readNames({ repo: 'o/r', token: 't', fetchImpl: fakeGitHub(names, { totalCount: 231 }) }), /listed 230 of total_count 231/);
  });
  it('nextLink reads rel="next" and nothing else', () => {
    assert.equal(nextLink('<https://x/a?page=2>; rel="next", <https://x/a?page=9>; rel="last"'), 'https://x/a?page=2');
    assert.equal(nextLink('<https://x/a?page=9>; rel="last"'), null);
    assert.equal(nextLink(null), null);
  });
});
