// ─────────────────────────────────────────────────────────────────────────────
// org-move.test.mjs — tooling/ops/org-move.mjs, the read-only rehearsal of the
// org move (port-codehost, 2026-10-03). Every case injects fetch and the guard
// spawn: nothing here touches the network, and every request the tool makes is
// recorded so "it never writes" is asserted, not assumed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { KNOWN_PINS, parseArgs, run } from '../../ops/org-move.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOL = join(REPO, 'tooling', 'ops', 'org-move.mjs');

/** A scratch tree holding the two registers the tool reads. */
function tree(mutate = (d) => d) {
  const root = mkdtempSync(join(tmpdir(), 'org-move-'));
  for (const rel of ['tooling/github-org.json', 'tooling/dead-repos.json', '.github/CODEOWNERS', 'packages/core/pubspec.yaml']) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  const p = join(root, 'tooling/github-org.json');
  writeFileSync(p, JSON.stringify(mutate(JSON.parse(readFileSync(p, 'utf8')))));
  return root;
}
const ORG = JSON.parse(readFileSync(join(REPO, 'tooling/github-org.json'), 'utf8')).org;
const guardOk = () => ({ status: 0, stdout: '  code-host limbs: 1 code/config file(s) scanned\n', stderr: '' });
const verdicts = (o) => Object.fromEntries(o.out.filter((l) => /^(PASS|FAIL|LOST) /.test(l)).map((l) => [l.split(/\s+/)[1], l.split(/\s+/)[0]]));

/** A recording fetch: answers from `table` (url-substring → {status, body}); records every call. */
function recorder(table) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    const hit = Object.entries(table).find(([k]) => String(url).includes(k));
    const a = hit ? hit[1] : { status: 404, body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status });
  };
  return { calls, impl };
}

describe('org-move.mjs — the invocation', () => {
  it('🔴 without --dry-run it REFUSES, exit 2 (the CLI and the parser)', () => {
    const r = spawnSync(process.execPath, [TOOL, '--to', 'nikatru-com'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /REFUSED — --dry-run is required/);
    assert.match(parseArgs(['--to', 'x']).error, /--dry-run is required/);
  });
  it('a no-value flag never eats an argument (shell-13); --to needs a value; unknown flags refuse', () => {
    assert.match(parseArgs(['--to', '--dry-run']).error, /is a flag, not a value/);
    assert.equal(parseArgs(['--dry-run', '--to', 'nikatru-com']).to, 'nikatru-com');
    assert.match(parseArgs(['--dry-run', '--force', '--to', 'x']).error, /unknown argument --force/);
  });
});

describe('org-move.mjs — the rehearsal', () => {
  it('without a token it sends NOTHING: every pin LOST, exit 2, and the in-tree edits listed', async () => {
    const net = recorder({});
    const o = await run({ to: 'nikatru-com', root: tree() }, { env: {}, fetch: net.impl, spawn: guardOk });
    assert.equal(o.code, 2);
    assert.deepEqual(net.calls, []);
    const v = verdicts(o);
    assert.equal(v.M2, 'PASS');
    assert.equal(v.M3, 'PASS');
    for (let n = 4; n < 4 + KNOWN_PINS.length; n++) assert.equal(v[`M${n}`], 'LOST', `M${n}`);
    const text = o.out.join('\n');
    assert.match(text, new RegExp(`tooling/github-org.json: "org": "${ORG}" → "nikatru-com"`));
    assert.match(text, /pin {2}packages\/core\/pubspec\.yaml/);
    assert.match(text, /OWNER STEP — mint a token for the new org/);
  });

  it('🔴 a fixture register with an UNLISTED pin is FAIL (exit 1), and so is one listing a pin nobody reads', async () => {
    const drop = await run({ to: 'nikatru-com', root: tree((d) => { d.renamePins.unobservable = d.renamePins.unobservable.filter((p) => p.id !== 'webhooks'); return d; }) }, { env: {}, fetch: recorder({}).impl, spawn: guardOk });
    assert.equal(drop.code, 1);
    assert.match(drop.out[0], /^org-move: FAIL — M3 pins listed: .*does not list: webhooks/);
    const extra = await run({ to: 'nikatru-com', root: tree((d) => { d.renamePins.unobservable.push({ id: 'mystery', what: 'x', why: 'y', notMeasured: 'z' }); return d; }) }, { env: {}, fetch: recorder({}).impl, spawn: guardOk });
    assert.equal(extra.code, 1);
    assert.match(extra.out[0], /lists mystery, which this tool cannot report on/);
  });

  it('🔴 with a token it CONFIRMS each pin by a GET — and only ever a GET', async () => {
    const net = recorder({
      '/users/nikatru-com': { status: 200, body: { type: 'Organization' } },
      '/user/installations': { status: 200, body: { installations: [{ app_slug: 'renovate' }, { app_slug: 'claude' }] } },
      '/actions/secrets': { status: 200, body: { secrets: [{ name: 'RENOVATE_TOKEN' }] } },
      '/environments': { status: 200, body: { environments: [{ name: 'store-publish' }] } },
      '/branches/main/protection': { status: 200, body: { required_status_checks: { contexts: ['ci-gate'] } } },
      '/hooks': { status: 200, body: [] },
      '/orgs/nikatru-com': { status: 200, body: { plan: { name: 'free' } } },
    });
    const o = await run({ to: 'nikatru-com', root: tree() }, { env: { GH_TOKEN: 'read-only-test' }, fetch: net.impl, spawn: guardOk });
    assert.ok(net.calls.length >= 7);
    assert.deepEqual([...new Set(net.calls.map((c) => c.method))], ['GET'], 'org-move never calls a write API');
    const v = verdicts(o);
    for (const id of ['M1', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M13']) assert.equal(v[id], 'PASS', id);
    assert.equal(v.M11, 'LOST'); // the dispatch token: an owner step, always
    assert.match(o.out.join('\n'), /ci-gate/);
    assert.ok(!o.out.join('\n').includes('read-only-test'), 'the token never prints');
  });

  it('🔴 the target that does not exist prints the names that DO (vacuous-09); the current org is refused', async () => {
    const net = recorder({ '/user/orgs': { status: 200, body: [{ login: 'nikatru-com' }] } });
    const o = await run({ to: 'nikatru-co', root: tree() }, { env: { GH_TOKEN: 't' }, fetch: net.impl, spawn: guardOk });
    assert.match(o.out.join('\n'), /FAIL {2}M1 target: nikatru-co does not exist .* the token's orgs are: nikatru-com/);
    const same = await run({ to: ORG, root: tree() }, { env: {}, fetch: recorder({}).impl, spawn: guardOk });
    assert.match(same.out.join('\n'), /FAIL {2}M1 target: .* is the CURRENT org/);
  });

  it('a red code-host guard (a literal typed somewhere) is M2 FAIL', async () => {
    const o = await run({ to: 'nikatru-com', root: tree() }, { env: {}, fetch: recorder({}).impl, spawn: () => ({ status: 1, stdout: '', stderr: "✗ 1 place(s) type the code host's name instead of reading the register:\n" }) });
    assert.equal(o.code, 1);
    assert.equal(verdicts(o).M2, 'FAIL');
  });
});
