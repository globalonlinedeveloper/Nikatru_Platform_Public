// worker-secrets-declared.test.mjs — assert-worker-secrets-declared.mjs must be
// able to FAIL, limb by limb: a green fixture first, then one recorded mutation
// per case, and the first output line names the limb. The last block runs the
// guard over a copy of the REAL tree and reddens it there too.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(HERE, '..', 'assert-worker-secrets-declared.mjs');

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  const out = `${r.stderr}${r.stdout}`;
  return { code: r.status, out, first: (r.stderr.trim() ? r.stderr : r.stdout).split('\n')[0] };
};

const row = (over = {}) => ({
  worker: 'w', secret: 'ACME_KEY', vaultKey: 'ACME_KEY_LIVE', setBy: 'vault', replace: 'explicit', kind: 'vendor', port: 'widgets', adapter: 'acme',
  purpose: 'the acme API key for widgets', rotation: 'acme console, then vault, then sync', consumers: ['services/w/src/acme.ts'], ...over,
});
const rows = () => [
  row(),
  row({ secret: 'OUR_KEY', vaultKey: 'OUR_KEY', kind: 'generated', port: null, adapter: null, generate: { bytes: 32, encoding: 'base64' }, consumers: ['services/w/src/crypto.ts'] }),
  row({ secret: 'STORE_TOKEN', vaultKey: 'STORE_TOKEN', port: null, adapter: null, consumers: ['services/w/src/receipts.ts'] }),
  row({ secret: 'ANON', vaultKey: 'ANON', setBy: 'deploy', port: null, adapter: null, consumers: ['services/w/src/acme.ts'] }),
];

function fixture({ manifest = { _why: ['fixture'], rows: rows() }, files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worker-secrets-'));
  const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const base = {
    'services/w/wrangler.jsonc': '{\n  // the Worker\n  "name": "w",\n  "vars": { "APP_ID": "w", "URL": "https://x.example/a" },\n  "env": { "sandbox": { "vars": { "APP_ID": "w" } } },\n}\n',
    'services/w/src/types.ts': 'export interface Env {\n  APP_ID: string;\n  URL: string;\n  RELEASE?: string;\n  // NOT_A_SECRET: string; a comment\n  ACME_KEY?: string;\n  OUR_KEY?: string;\n  ANON?: string;\n  DB: D1Database;\n}\n',
    'services/w/src/acme.ts': 'export const k = (env) => env.ACME_KEY ?? env.ANON;\n',
    'services/w/src/crypto.ts': 'export const k = (env) => env.OUR_KEY;\n',
    'services/w/src/receipts.ts': "export const v = { credentialEnvVars: ['STORE_TOKEN'] };\n",
    '.github/workflows/deploy-workers.yml': 'jobs:\n  d:\n    steps:\n      - env:\n          ANON: ${{ secrets.ANON }}\n        run: deploy --var RELEASE:${{ github.sha }}\n',
    'tooling/ports/widgets.json': JSON.stringify({ port: 'widgets', adapters: [{ id: 'acme' }, { id: 'fake' }] }),
  };
  for (const [rel, text] of Object.entries({ ...base, ...files })) if (text !== null) w(rel, text);
  if (manifest !== null) w('tooling/worker-secrets.json', typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2));
  return root;
}
const mutate = (fn) => { const m = { _why: ['fixture'], rows: rows() }; fn(m); return fixture({ manifest: m }); };

describe('assert-worker-secrets-declared — the fixture', () => {
  it('green control: every read is a row, deploy vars and wrangler vars are not secrets', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.match(r.first, /^OK/);
    assert.match(r.out, /read 4 secret name\(s\) across 1 Worker/);
  });
  it('A: an Env secret with no row exits 1, naming it', () => {
    const r = run(mutate((m) => { m.rows = m.rows.filter((x) => x.secret !== 'OUR_KEY'); }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb A: w reads OUR_KEY .*interface Env/);
  });
  it('A: a credentialEnvVars name (read by env[name], in no Env) with no row exits 1', () => {
    const r = run(mutate((m) => { m.rows = m.rows.filter((x) => x.secret !== 'STORE_TOKEN'); }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb A: w reads STORE_TOKEN .*credentialEnvVars/);
  });
  it('A: a secretEnvVar literal with no row exits 1', () => {
    const r = run(fixture({ files: { 'services/w/src/verifier.ts': "export const v = { secretEnvVar: 'HOOK_SECRET' };\n" } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb A: w reads HOOK_SECRET .*secretEnvVar/);
  });
  it('A: a wrangler secrets.required name with no row exits 1', () => {
    const r = run(fixture({ files: { 'services/w/wrangler.jsonc': '{ "name": "w", "vars": { "APP_ID": "w", "URL": "u" }, "secrets": { "required": ["REQ_KEY"] } }' } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /limb A: w reads REQ_KEY .*secrets\.required/);
  });
  it('A: a row whose Worker reads no such secret is stale (exit 1)', () => {
    const r = run(mutate((m) => { m.rows.push(row({ secret: 'GONE_KEY', vaultKey: 'GONE_KEY', port: null, adapter: null, consumers: ['services/w/src/acme.ts'] })); }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /limb A: .*declares w\/GONE_KEY, but services\/w reads no GONE_KEY: a stale row/);
  });
  it('B: a consumer that does not exist exits 1', () => {
    const r = run(mutate((m) => { m.rows[0].consumers = ['services/w/src/nope.ts']; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb B: .*consumer "services\/w\/src\/nope.ts" does not exist/);
  });
  it('B: a consumer naming the secret only in a comment exits 1', () => {
    const r = run(mutate((m) => { m.rows[1].consumers = ['services/w/src/receipts.ts']; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb B: .*never names OUR_KEY outside a comment/);
  });
  it('C: a value-shaped string in the manifest exits 1', () => {
    const r = run(mutate((m) => { m.rows[0].purpose = `the key is ${['sk', 'live', 'ABCDEFGH12345678'].join('_')} for widgets`; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb C: .*secret-shaped token/);
  });
  it('C: a row carrying a `value` or a `hash` key exits 1', () => {
    const r = run(mutate((m) => { m.rows[0].hash = 'deadbeef'; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb C: .*carries key `hash`/);
  });
  it('D: a row naming an adapter its port does not have exits 1', () => {
    const r = run(mutate((m) => { m.rows[0].adapter = 'nobody'; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb D: .*adapter "nobody" is no adapter of tooling\/ports\/widgets.json/);
  });
  it('D: a row naming an unknown port exits 1; a port without an adapter exits 1', () => {
    assert.match(run(mutate((m) => { m.rows[0].port = 'gizmos'; })).first, /limb D: .*port "gizmos" is no/);
    assert.match(run(mutate((m) => { m.rows[0].adapter = null; })).first, /limb D: .*both null or both set/);
  });
  it('E: a row on a script no wrangler config declares exits 1; <name>-sandbox is known', () => {
    assert.match(run(mutate((m) => { m.rows[0].worker = 'elsewhere'; })).first, /limb E: .*worker "elsewhere" is no wrangler script/);
    const ok = run(mutate((m) => { m.rows.push(row({ worker: 'w-sandbox', secret: 'OUR_KEY', vaultKey: 'OUR_KEY_SANDBOX', kind: 'generated', port: null, adapter: null, generate: { bytes: 32, encoding: 'base64' }, consumers: ['services/w/src/crypto.ts'] })); }));
    assert.equal(ok.code, 0, ok.out);
  });
  it('F: a duplicated (worker, secret) exits 1', () => {
    const r = run(mutate((m) => { m.rows.push({ ...m.rows[0] }); }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /limb F: .*declares w\/ACME_KEY twice/);
  });
  // ⏱ 2026-10-02 · #1135 review finding 1: whether a LIVE value may ever be overwritten is data.
  it('🔴 G: a row with no `replace`, an unknown one, or a TOKEN_ENC_KEY_* row that is not `never` exits 1', () => {
    assert.match(run(mutate((m) => { delete m.rows[0].replace; })).first, /limb G: .*replace undefined is not one of never\|explicit/);
    assert.match(run(mutate((m) => { m.rows[0].replace = 'sometimes'; })).first, /limb G: .*replace "sometimes"/);
    const enc = { _why: ['fixture'], rows: rows() };
    enc.rows[1] = { ...enc.rows[1], secret: 'TOKEN_ENC_KEY_V1', vaultKey: 'TOKEN_ENC_KEY_V1' };
    const r = run(fixture({ manifest: enc, files: {
      'services/w/src/types.ts': 'export interface Env {\n  APP_ID: string;\n  URL: string;\n  RELEASE?: string;\n  ACME_KEY?: string;\n  TOKEN_ENC_KEY_V1?: string;\n  ANON?: string;\n  DB: D1Database;\n}\n',
      'services/w/src/crypto.ts': 'export const k = (env) => env.TOKEN_ENC_KEY_V1;\n',
    } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb G: .*w\/TOKEN_ENC_KEY_V1\) seals stored data and says replace "explicit"/);
    enc.rows[1].replace = 'never';
    const ok = run(fixture({ manifest: enc, files: {
      'services/w/src/types.ts': 'export interface Env {\n  APP_ID: string;\n  URL: string;\n  RELEASE?: string;\n  ACME_KEY?: string;\n  TOKEN_ENC_KEY_V1?: string;\n  ANON?: string;\n  DB: D1Database;\n}\n',
      'services/w/src/crypto.ts': 'export const k = (env) => env.TOKEN_ENC_KEY_V1;\n',
    } }));
    assert.equal(ok.code, 0, ok.out);
  });
  it('G: a generated row without its generate spec, and a deploy row the deploy does not carry, exit 1', () => {
    assert.match(run(mutate((m) => { delete m.rows[1].generate; })).first, /limb G: .*generated but declares no generate/);
    assert.match(run(mutate((m) => { m.rows[1].generate.bytes = 16; })).first, /limb G: .*generate \{bytes >= 32/);
    assert.match(run(mutate((m) => { m.rows[2].setBy = 'deploy'; })).first, /limb G: .*setBy deploy, but .*carries no secrets\.STORE_TOKEN/);
    assert.match(run(mutate((m) => { m.rows[0].kind = 'manual'; })).first, /limb G: .*kind "manual"/);
  });
  it('COVERAGE LOST: no manifest, an empty manifest, or a tree with no Worker read exits 2', () => {
    assert.equal(run(fixture({ manifest: null })).code, 2);
    assert.equal(run(fixture({ manifest: { rows: [] } })).code, 2);
    const blind = run(fixture({ files: { 'services/w/src/types.ts': 'export interface Env {\n  APP_ID: string;\n}\n', 'services/w/src/receipts.ts': '' } }));
    assert.equal(blind.code, 2, blind.out);
    assert.match(blind.first, /COVERAGE LOST — limb A: no Worker/);
  });
});

describe('assert-worker-secrets-declared — a copy of the REAL tree', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'worker-secrets-real-'));
    for (const rel of ['services', 'tooling/worker-secrets.json', 'tooling/ports', '.github/workflows']) {
      cpSync(join(REPO, rel), join(root, rel), { recursive: true, filter: (src) => !/node_modules/.test(src) });
    }
  });
  it('green control: the real manifest covers every real read', () => {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  });
  it('red: deleting the real TOKEN_ENC_KEY_V1 row exits 1 naming it', () => {
    const rel = join(root, 'tooling/worker-secrets.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      doc.rows = doc.rows.filter((x) => !(x.worker === 'platform' && x.secret === 'TOKEN_ENC_KEY_V1'));
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /limb A: platform reads TOKEN_ENC_KEY_V1/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a new receipt credential read by env[name] in the real platform source exits 1', () => {
    const rel = join(root, 'services/platform/src/lib/receipts/microsoft.ts');
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, before.replace("credentialEnvVars: ['MICROSOFT_STORE_SERVICE_TOKEN']", "credentialEnvVars: ['MICROSOFT_STORE_SERVICE_TOKEN', 'MICROSOFT_STORE_TENANT_SECRET']"));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /limb A: platform reads MICROSOFT_STORE_TENANT_SECRET/);
    } finally { writeFileSync(rel, before); }
  });
});
