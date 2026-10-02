// worker-secrets-tool.test.mjs — tooling/ops/worker-secrets.mjs against a
// LOOPBACK Cloudflare double: the sync is idempotent by the ledger, a bulk sync
// never provisions, generate writes the vault before the PUT and never replaces
// a key, and no value is ever printed (a length and a sha8 only).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decideSync, parseArgs, parseVault, fingerprint, sha256, readVault, withVaultKey, writeVaultOnce } from '../../ops/worker-secrets.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const TOOL = join(REPO, 'tooling/ops/worker-secrets.mjs');
// Built, not written: a literal key-shaped fixture is what gitleaks (rightly) refuses.
const SECRET_VALUE = 'fixture-value-not-a-key-'.repeat(2);

const row = (over = {}) => ({ worker: 'w', secret: 'K', vaultKey: 'K', setBy: 'vault', replace: 'explicit', kind: 'vendor', ...over });

describe('worker-secrets — decisions', () => {
  // ⏱ 2026-10-02 · #1135 review finding 1: a LIVE name is overwritten only on an `explicit` row
  // with `--replace <NAME>` spelled out; a `never` row (TOKEN_ENC_KEY_*) never, by any flag.
  it('a live, unchanged value is skipped; a live, CHANGED value is refused without --replace <NAME>, put with it', () => {
    const base = { vaultValue: 'v', livePresent: true, ledgerSha: sha256('v') };
    assert.equal(decideSync(row(), base).action, 'skip');
    assert.equal(decideSync(row(), { ...base, ledgerSha: sha256('old') }).action, 'refuse');
    assert.equal(decideSync(row(), { ...base, ledgerSha: undefined }).action, 'refuse', 'no ledger entry is not permission');
    assert.equal(decideSync(row(), { ...base, ledgerSha: sha256('old'), replace: ['OTHER'] }).action, 'refuse', '--replace names ONE secret');
    assert.equal(decideSync(row(), { ...base, ledgerSha: sha256('old'), replace: ['K'] }).action, 'put');
    assert.equal(decideSync(row(), { ...base, force: true }).action, 'refuse', '--force alone never overwrites a live name');
    assert.equal(decideSync(row(), { ...base, force: true, replace: ['K'] }).action, 'put');
  });
  it('🔴 a `replace: "never"` row is NEVER overwritten while live, by any flag; a row without `replace` is treated as never', () => {
    const base = { vaultValue: 'v', livePresent: true, ledgerSha: sha256('old'), replace: ['K'], force: true };
    const d = decideSync(row({ replace: 'never' }), base);
    assert.equal(d.action, 'refuse');
    assert.match(d.why, /never overwritten in place, by any flag/);
    assert.equal(decideSync(row({ replace: undefined }), base).action, 'refuse');
    assert.equal(decideSync(row({ replace: 'never' }), { vaultValue: 'v', livePresent: true, ledgerSha: sha256('v') }).action, 'skip', 'an unchanged live value PUTs nothing');
    assert.equal(decideSync(row({ replace: 'never' }), { vaultValue: 'v', livePresent: false, explicit: true }).action, 'put', 'provisioning an ABSENT name is not a replace');
  });
  it('the refusal prints a length, and a sha8 only for a value long enough not to give itself away', () => {
    const long = decideSync(row(), { vaultValue: SECRET_VALUE, livePresent: true, ledgerSha: sha256('old') });
    assert.match(long.why, new RegExp(`len ${SECRET_VALUE.length} sha8 [0-9a-f]{8}`));
    assert.ok(!long.why.includes(SECRET_VALUE));
    const short = decideSync(row(), { vaultValue: 'true', livePresent: true, ledgerSha: sha256('old') });
    assert.match(short.why, /the vault holds len 4;/);
    assert.doesNotMatch(short.why, /sha8/);
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
    // #1135 review nit: a short value's hash is a dictionary lookup away from the value.
    assert.equal(fingerprint('true'), 'len 4');
    assert.equal(fingerprint('a'.repeat(15)), 'len 15');
    assert.match(fingerprint('a'.repeat(16)), /^len 16 sha8 [0-9a-f]{8}$/);
  });
  it('argv: generate takes one name; --adapter needs --port; unknown flags refuse', () => {
    assert.ok(parseArgs(['generate']).error);
    assert.ok(parseArgs(['check', '--adapter', 'x']).error);
    assert.ok(parseArgs(['sync', '--bogus']).error);
    assert.equal(parseArgs(['sync', '--secret', 'K', '--dry-run']).dryRun, true);
  });
});

// ⏱ 2026-10-02 · CodeQL #552 (js/file-system-race, high) on PR #1135: `generate` checked the vault
// with existsSync, read it, then APPENDED in a second access. The vault is now read once, the new
// text built and verified in memory, and written ONCE (temp file + rename).
describe('worker-secrets — the vault is read once and written once (CodeQL #552)', () => {
  it('🔴 writeVaultOnce: exactly ONE write (a fresh temp file, `wx`) and ONE rename over the vault, with the new text', () => {
    const writes = [];
    const renames = [];
    const next = withVaultKey('A="1"\nB="2"', 'NEW_KEY', 'v-123');
    const asRead = { mtimeMs: 1000, size: 11 };
    writeVaultOnce('/v/secrets.env', next, asRead, { write: (...a) => writes.push(a), rename: (...a) => renames.push(a), stat: () => ({ ...asRead }), remove: () => assert.fail('nothing to remove') });
    assert.equal(writes.length, 1, 'the vault content is written in one call');
    assert.equal(writes[0][0], `/v/secrets.env.tmp-${process.pid}`);
    assert.equal(writes[0][1], 'A="1"\nB="2"\nNEW_KEY="v-123"\n');
    assert.deepEqual(writes[0][2], { mode: 0o600, flag: 'wx' });
    assert.deepEqual(renames, [[`/v/secrets.env.tmp-${process.pid}`, '/v/secrets.env']]);
    assert.equal(parseVault(writes[0][1]).get('NEW_KEY'), 'v-123');
  });
  it('🔴 writeVaultOnce refuses a CONCURRENT EDIT: the vault\'s mtime or size moved since the read → no rename, temp file removed', () => {
    for (const moved of [{ mtimeMs: 1001, size: 11 }, { mtimeMs: 1000, size: 12 }]) {
      const renames = [];
      const removed = [];
      assert.throws(
        () => writeVaultOnce('/v/secrets.env', 'X="1"\n', { mtimeMs: 1000, size: 11 }, { write: () => {}, rename: (...a) => renames.push(a), stat: () => moved, remove: (p) => removed.push(p) }),
        /changed since it was read .*nothing was written/,
      );
      assert.deepEqual(renames, [], 'the vault was replaced over a concurrent edit');
      assert.deepEqual(removed, [`/v/secrets.env.tmp-${process.pid}`]);
    }
    assert.throws(() => writeVaultOnce('/v/secrets.env', 'X', undefined, { write: () => {}, rename: () => {} }), /needs the mtime and size/);
  });
  it('withVaultKey verifies in memory before anything is written: a value the vault grammar would mangle refuses', () => {
    assert.throws(() => withVaultKey('', 'K', 'a"b\nc'), /nothing was written/);
  });
  it('readVault: ONE read per candidate and no existence check; ENOENT moves on, any other error is thrown', () => {
    const reads = [];
    const root = REPO; // a git checkout: two candidates (its own .claude/, then the main checkout's)
    const prev = process.env.NIKATRU_VAULT;
    delete process.env.NIKATRU_VAULT;
    try {
      const notALink = () => { throw Object.assign(new Error('not a link'), { code: 'EINVAL' }); };
      const stat = () => ({ mtimeMs: 7, size: 6 });
      const r = readVault(root, { read: (p) => { reads.push(p); if (reads.length === 1) throw Object.assign(new Error('no'), { code: 'ENOENT' }); return 'K="v"\n'; }, readlink: notALink, stat });
      assert.equal(r.text, 'K="v"\n');
      assert.deepEqual([r.mtimeMs, r.size], [7, 6], 'the mtime and size the write will compare against');
      assert.equal(reads.length, 2, 'one read for the missing candidate, one for the vault, nothing else');
      assert.throws(() => readVault(root, { read: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, readlink: notALink, stat }), /denied/);
      // #1135 review nit: a symlinked vault would be replaced by a regular file at the rename.
      assert.throws(() => readVault(root, { read: () => 'K="v"\n', readlink: () => '/elsewhere/secrets.env', stat }), /is a symlink/);
    } finally { if (prev !== undefined) process.env.NIKATRU_VAULT = prev; }
  });
  it('🔴 a REAL symlinked vault is refused (skipped only where this host cannot create a symlink)', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'vault-link-'));
    writeFileSync(join(dir, 'real.env'), 'K="v"\n');
    try { symlinkSync(join(dir, 'real.env'), join(dir, 'link.env')); } catch (e) { if (e.code === 'EPERM') { t.skip('this host cannot create a symlink (Windows without developer mode); CI runs it'); return; } throw e; }
    const prev = process.env.NIKATRU_VAULT;
    process.env.NIKATRU_VAULT = join(dir, 'link.env');
    try { assert.throws(() => readVault(dir), /is a symlink/); } finally { if (prev === undefined) delete process.env.NIKATRU_VAULT; else process.env.NIKATRU_VAULT = prev; }
  });
  it('🔴 the module has no appendFileSync, copyFileSync or existsSync in code (comments aside): no check-then-use, no second access', () => {
    const src = stripSourceComments(readFileSync(TOOL, 'utf8'), '.mjs');
    assert.doesNotMatch(src, /\b(appendFileSync|copyFileSync|existsSync)\b/);
  });
});

/** A loopback double of the two Cloudflare calls the tool makes. */
async function fakeCloudflare(live, { listBody = null } = {}) {
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
      if (req.method === 'GET') { res.end(JSON.stringify(listBody ? listBody(script, [...live.get(script)]) : { success: true, result: [...live.get(script)].map((name) => ({ name })) })); return; }
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
  w('services/w/src/types.ts', 'export interface Env {\n  LIVE_KEY?: string;\n  NEW_KEY?: string;\n  OUR_KEY?: string;\n  SEAL_KEY?: string;\n}\n');
  w('tooling/worker-secrets.json', JSON.stringify({ rows: [
    row({ secret: 'LIVE_KEY', vaultKey: 'LIVE_KEY_V' }),
    row({ secret: 'NEW_KEY', vaultKey: 'NEW_KEY' }),
    row({ secret: 'OUR_KEY', vaultKey: 'OUR_KEY_SANDBOX', worker: 'w-sandbox', replace: 'never', kind: 'generated', generate: { bytes: 32, encoding: 'base64' }, rotation: 'never replace' }),
    row({ secret: 'SEAL_KEY', vaultKey: 'SEAL_KEY', replace: 'never', kind: 'generated', generate: { bytes: 32, encoding: 'base64' }, rotation: 'a new name plus a migration' }),
  ] }));
  w('vault/secrets.env', `CLOUDFLARE_ACCOUNT_ID="acct"\nCLOUDFLARE_API_TOKEN="tok"\nLIVE_KEY_V="${SECRET_VALUE}"\nNEW_KEY="new-value-1"\nSEAL_KEY="${'s'.repeat(44)}"\n`);
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
  it('sync with --replace LIVE_KEY PUTs once, then skips the unchanged value; a bulk sync leaves the absent NEW_KEY alone; nothing prints a value', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set(['LIVE_KEY'])], ['w-sandbox', new Set()]]));
    try {
      const first = await cli(root, cf.base, ['sync', '--replace', 'LIVE_KEY']);
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
      assert.match(again.out, /is LIVE: generate never writes over a live secret/);
      assert.equal(cf.puts.length, 1);
    } finally { cf.server.close(); }
  });
  // ⏱ 2026-10-02 · #1135 review finding 1 (MAJOR), reproduced by the reviewer: generate PUT a fresh
  // value over a LIVE key because only the vault was consulted. Each case below exits 1 with NO PUT.
  it('🔴 RED CONTROL: generate over a name LIVE on the Worker refuses — the vault lacking it is a custody gap, not a licence', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set()], ['w-sandbox', new Set(['OUR_KEY'])]]));
    try {
      const before = readFileSync(join(root, 'vault/secrets.env'), 'utf8');
      const g = await cli(root, cf.base, ['generate', 'OUR_KEY']);
      assert.equal(g.code, 1, g.out);
      assert.match(g.out, /w-sandbox\/OUR_KEY is LIVE: generate never writes over a live secret .*CUSTODY GAP/);
      assert.deepEqual(cf.puts, [], 'a live key was overwritten');
      assert.equal(readFileSync(join(root, 'vault/secrets.env'), 'utf8'), before, 'the vault was written before the refusal');
    } finally { cf.server.close(); }
  });
  // ⏱ 2026-10-02 · #1135 review 2: the live-name listing FAILS CLOSED. A listing it cannot read
  // answered "no live names" before, and generate then wrote over the live key.
  it('🔴 RED CONTROL: a 200 listing with NO `result` array makes generate refuse (exit 2), with no write', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set()], ['w-sandbox', new Set(['OUR_KEY'])]]), { listBody: () => ({ success: true }) });
    try {
      const before = readFileSync(join(root, 'vault/secrets.env'), 'utf8');
      const g = await cli(root, cf.base, ['generate', 'OUR_KEY']);
      assert.equal(g.code, 2, g.out);
      assert.match(g.out, /COVERAGE LOST — listing w-sandbox's secret names: a success with no `result` array/);
      assert.deepEqual(cf.puts, [], 'a key was written over an unreadable listing');
      assert.equal(readFileSync(join(root, 'vault/secrets.env'), 'utf8'), before, 'the vault was written');
    } finally { cf.server.close(); }
  });
  it('🔴 RED CONTROL: a listing whose names do not add up to its total_count makes generate refuse (exit 2), with no write', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set()], ['w-sandbox', new Set(['OUR_KEY'])]]), {
      listBody: (_s, names) => ({ success: true, result: [], result_info: { page: 1, per_page: 20, count: 0, total_count: names.length } }),
    });
    try {
      const before = readFileSync(join(root, 'vault/secrets.env'), 'utf8');
      const g = await cli(root, cf.base, ['generate', 'OUR_KEY']);
      assert.equal(g.code, 2, g.out);
      assert.match(g.out, /read 0 of total_count 1; refusing a partial listing/);
      assert.deepEqual(cf.puts, [], 'a key was written over a partial listing');
      assert.equal(readFileSync(join(root, 'vault/secrets.env'), 'utf8'), before, 'the vault was written');
    } finally { cf.server.close(); }
  });
  it('a paginated listing is read to its last page: a live name on page 2 still refuses generate', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set()], ['w-sandbox', new Set(['OUR_KEY'])]]), {
      listBody: (_s, names) => ({ success: true, result: [{ name: 'OTHER' }], result_info: { page: 1, per_page: 1, total_pages: 2, total_count: names.length + 1 } }),
    });
    try {
      const g = await cli(root, cf.base, ['generate', 'OUR_KEY']);
      assert.notEqual(g.code, 0, g.out);
      assert.deepEqual(cf.puts, []);
    } finally { cf.server.close(); }
  });
  it('🔴 RED CONTROL: sync over a LIVE `replace: "never"` name refuses, with --force and --replace too', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set(['SEAL_KEY'])], ['w-sandbox', new Set()]]));
    try {
      for (const args of [['sync', '--secret', 'SEAL_KEY'], ['sync', '--secret', 'SEAL_KEY', '--force'], ['sync', '--secret', 'SEAL_KEY', '--replace', 'SEAL_KEY', '--force']]) {
        const r = await cli(root, cf.base, args);
        assert.equal(r.code, 1, `${args.join(' ')}\n${r.out}`);
        assert.match(r.out, /REFUSED w\/SEAL_KEY .*never overwritten in place, by any flag/);
      }
      assert.deepEqual(cf.puts, [], 'a never-replace key was overwritten');
    } finally { cf.server.close(); }
  });
  it('🔴 RED CONTROL: sync over a LIVE `explicit` name without --replace refuses, naming the flag and the length/hash only; with it, it PUTs', async () => {
    const root = tree();
    const cf = await fakeCloudflare(new Map([['w', new Set(['LIVE_KEY'])], ['w-sandbox', new Set()]]));
    try {
      for (const args of [['sync', '--secret', 'LIVE_KEY'], ['sync', '--secret', 'LIVE_KEY', '--force']]) {
        const r = await cli(root, cf.base, args);
        assert.equal(r.code, 1, `${args.join(' ')}\n${r.out}`);
        assert.match(r.out, new RegExp(`REFUSED w/LIVE_KEY .*needs \`--replace LIVE_KEY\` spelled out \\(the vault holds len ${SECRET_VALUE.length} sha8 [0-9a-f]{8}`));
        assert.ok(!r.out.includes(SECRET_VALUE), 'a value was printed');
      }
      assert.deepEqual(cf.puts, []);
      const ok = await cli(root, cf.base, ['sync', '--secret', 'LIVE_KEY', '--replace', 'LIVE_KEY']);
      assert.equal(ok.code, 0, ok.out);
      assert.deepEqual(cf.puts.map((p) => p.name), ['LIVE_KEY']);
      const stray = await cli(root, cf.base, ['sync', '--secret', 'LIVE_KEY', '--replace', 'NEW_KEY']);
      assert.equal(stray.code, 2, stray.out);
      assert.match(stray.out, /--replace NEW_KEY names no selected row/);
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
