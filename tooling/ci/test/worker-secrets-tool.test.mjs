// worker-secrets-tool.test.mjs — tooling/ops/worker-secrets.mjs against a
// LOOPBACK Cloudflare double: the sync is idempotent by the ledger, a bulk sync
// never provisions, generate writes the vault before the PUT and never replaces
// a key, and no value is ever printed (a length and a sha8 only).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decideSync, parseArgs, parseVault, fingerprint, sha256 } from '../../ops/worker-secrets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const TOOL = join(REPO, 'tooling/ops/worker-secrets.mjs');
// Built, not written: a literal key-shaped fixture is what gitleaks (rightly) refuses.
const SECRET_VALUE = 'fixture-value-not-a-key-'.repeat(2);

const row = (over = {}) => ({ worker: 'w', secret: 'K', vaultKey: 'K', setBy: 'vault', kind: 'vendor', ...over });

describe('worker-secrets — decisions', () => {
  it('an unchanged live value is skipped; --force always PUTs', () => {
    const base = { vaultValue: 'v', livePresent: true, ledgerSha: sha256('v') };
    assert.equal(decideSync(row(), base).action, 'skip');
    assert.equal(decideSync(row(), { ...base, force: true }).action, 'put');
    assert.equal(decideSync(row(), { ...base, ledgerSha: sha256('old') }).action, 'put');
  });
  it('a bulk sync never provisions an absent secret; an explicit --secret does', () => {
    assert.equal(decideSync(row(), { vaultValue: 'v', livePresent: false }).action, 'skip');
    assert.equal(decideSync(row(), { vaultValue: 'v', livePresent: false, explicit: true }).action, 'put');
  });
  it('live but not in the vault is a refused CUSTODY GAP; a deploy row is never written', () => {
    const d = decideSync(row(), { vaultValue: undefined, livePresent: true });
    assert.equal(d.action, 'refuse');
    assert.match(d.why, /CUSTODY GAP/);
    assert.equal(decideSync(row({ setBy: 'deploy' }), { vaultValue: 'v', livePresent: true, force: true }).action, 'skip');
  });
  it('the vault parser strips quotes (TRAPS ci-14) and the fingerprint never carries the value', () => {
    const v = parseVault('A="x y"\nexport B=\'z\'\n# C=no\nD=plain\n');
    assert.deepEqual([...v], [['A', 'x y'], ['B', 'z'], ['D', 'plain']]);
    assert.doesNotMatch(fingerprint(SECRET_VALUE), new RegExp(SECRET_VALUE.slice(0, 12)));
    assert.match(fingerprint(SECRET_VALUE), new RegExp(`^len ${SECRET_VALUE.length} sha8 [0-9a-f]{8}$`));
  });
  it('argv: generate takes one name; --adapter needs --port; unknown flags refuse', () => {
    assert.ok(parseArgs(['generate']).error);
    assert.ok(parseArgs(['check', '--adapter', 'x']).error);
    assert.ok(parseArgs(['sync', '--bogus']).error);
    assert.equal(parseArgs(['sync', '--secret', 'K', '--dry-run']).dryRun, true);
  });
});

/** A loopback double of the two Cloudflare calls the tool makes. */
async function fakeCloudflare(live) {
  const puts = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const m = req.url.match(/\/accounts\/acct\/workers\/scripts\/([^/]+)\/secrets$/);
      res.setHeader('content-type', 'application/json');
      if (!m || req.headers.authorization !== 'Bearer tok') { res.statusCode = 403; res.end('{"success":false}'); return; }
      const script = decodeURIComponent(m[1]);
      if (!live.has(script)) { res.statusCode = 404; res.end('{"success":false,"errors":[{"code":10007,"message":"not found"}]}'); return; }
      if (req.method === 'GET') { res.end(JSON.stringify({ success: true, result: [...live.get(script)].map((name) => ({ name })) })); return; }
      const j = JSON.parse(body);
      puts.push({ script, name: j.name, sha: sha256(j.text) });
      live.get(script).add(j.name);
      res.end('{"success":true,"result":{}}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, puts, base: `http://127.0.0.1:${server.address().port}` };
}

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'worker-secrets-tool-'));
  const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  w('services/w/wrangler.jsonc', '{ "name": "w", "env": { "sandbox": {} } }');
  w('services/w/src/types.ts', 'export interface Env {\n  LIVE_KEY?: string;\n  NEW_KEY?: string;\n  OUR_KEY?: string;\n}\n');
  w('tooling/worker-secrets.json', JSON.stringify({ rows: [
    row({ secret: 'LIVE_KEY', vaultKey: 'LIVE_KEY_V' }),
    row({ secret: 'NEW_KEY', vaultKey: 'NEW_KEY' }),
    row({ secret: 'OUR_KEY', vaultKey: 'OUR_KEY_SANDBOX', worker: 'w-sandbox', kind: 'generated', generate: { bytes: 32, encoding: 'base64' }, rotation: 'never replace' }),
  ] }));
  w('vault/secrets.env', `CLOUDFLARE_ACCOUNT_ID="acct"\nCLOUDFLARE_API_TOKEN="tok"\nLIVE_KEY_V="${SECRET_VALUE}"\nNEW_KEY="new-value-1"\n`);
  return root;
}

function cli(root, base, args) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [TOOL, ...args, '--root', root], {
      env: { ...process.env, NIKATRU_VAULT: join(root, 'vault/secrets.env'), CLOUDFLARE_API_BASE: base, CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' },
    });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    const t = setTimeout(() => p.kill(), 60_000);
    p.on('close', (code) => { clearTimeout(t); done({ code, out }); });
  });
}

describe('worker-secrets — the CLI over a loopback Cloudflare', () => {
  it('sync PUTs once, then skips the unchanged value; a bulk sync leaves the absent NEW_KEY alone; nothing prints a value', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set(['LIVE_KEY'])], ['w-sandbox', new Set()]]));
    try {
      const first = await cli(root, cf.base, ['sync']);
      assert.equal(first.code, 0, first.out);
      assert.match(first.out, new RegExp(`PUT w/LIVE_KEY \\(len ${SECRET_VALUE.length} sha8 [0-9a-f]{8}\\): HTTP 200`));
      assert.match(first.out, /skipped w\/NEW_KEY .*provisioning takes an explicit --secret/);
      assert.deepEqual(cf.puts.map((p) => p.name), ['LIVE_KEY']);
      const second = await cli(root, cf.base, ['sync']);
      assert.match(second.out, /skipped w\/LIVE_KEY .*unchanged/);
      assert.equal(cf.puts.length, 1, 'the unchanged value was not PUT again');
      const ledger = JSON.parse(readFileSync(join(root, 'vault/worker-secrets.ledger.json'), 'utf8'));
      assert.equal(ledger['w/LIVE_KEY'].sha256, sha256(SECRET_VALUE));
      for (const o of [first.out, second.out]) assert.ok(!o.includes(SECRET_VALUE), 'a value was printed');
      const dry = await cli(root, cf.base, ['sync', '--secret', 'NEW_KEY', '--dry-run']);
      assert.match(dry.out, /DRY RUN — would PUT w\/NEW_KEY/);
      assert.equal(cf.puts.length, 1, 'a dry run PUT nothing');
    } finally { cf.server.close(); }
  });
  it('check: an undeclared live name and a custody gap exit 1; --port lines are `<name> <present|absent> <len> <sha8>`', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set(['LIVE_KEY', 'STRAY'])], ['w-sandbox', new Set(['OUR_KEY'])]]));
    try {
      const r = await cli(root, cf.base, ['check']);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /UNDECLARED w\/STRAY/);
      assert.match(r.out, /CUSTODY GAP w-sandbox\/OUR_KEY/);
      assert.ok(!r.out.includes(SECRET_VALUE));
    } finally { cf.server.close(); }
    const doc = JSON.parse(readFileSync(join(root, 'tooling/worker-secrets.json'), 'utf8'));
    doc.rows[0].port = 'widgets';
    doc.rows[0].adapter = 'acme';
    writeFileSync(join(root, 'tooling/worker-secrets.json'), JSON.stringify(doc));
    const cf2 = await fakeCloudflare(new Map([['w', new Set(['LIVE_KEY'])], ['w-sandbox', new Set()]]));
    try {
      const p = await cli(root, cf2.base, ['check', '--port', 'widgets', '--adapter', 'acme']);
      assert.equal(p.code, 0, p.out);
      assert.match(p.out.trim(), new RegExp(`^LIVE_KEY present ${SECRET_VALUE.length} [0-9a-f]{8}$`));
    } finally { cf2.server.close(); }
  });
  it('generate writes the vault FIRST (with a backup), then PUTs; a second generate refuses to replace the key', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set()], ['w-sandbox', new Set()]]));
    try {
      const g = await cli(root, cf.base, ['generate', 'OUR_KEY']);
      assert.equal(g.code, 0, g.out);
      const vault = parseVault(readFileSync(join(root, 'vault/secrets.env'), 'utf8'));
      const v = vault.get('OUR_KEY_SANDBOX');
      assert.equal(Buffer.from(v, 'base64').length, 32);
      assert.deepEqual(cf.puts, [{ script: 'w-sandbox', name: 'OUR_KEY', sha: sha256(v) }]);
      assert.ok(!g.out.includes(v), 'the generated value was printed');
      assert.ok(readdirSync(join(root, 'vault')).some((f) => f.startsWith('secrets.env.pre-OUR_KEY_SANDBOX-')), 'no backup copy');
      const again = await cli(root, cf.base, ['generate', 'OUR_KEY']);
      assert.equal(again.code, 1, again.out);
      assert.match(again.out, /already exists .*generate never replaces a key/);
      assert.equal(cf.puts.length, 1);
    } finally { cf.server.close(); }
  });
  it('refuses a non-loopback API base, so the token cannot be sent elsewhere', async () => {
    const r = await cli(tree(), 'https://evil.example', ['check']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /CLOUDFLARE_API_BASE may only be a 127\.0\.0\.1 test double/);
  });
  it('COVERAGE LOST (exit 2) when the vault is absent', async () => {
    const root = tree();
    const r = await new Promise((done) => {
      const p = spawn(process.execPath, [TOOL, 'check', '--root', root], { env: { ...process.env, NIKATRU_VAULT: join(root, 'vault/nope.env') } });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { out += c; });
      p.on('close', (code) => done({ code, out }));
    });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — the vault/);
    assert.ok(existsSync(join(root, 'vault/secrets.env')));
  });
});
