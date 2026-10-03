// ─────────────────────────────────────────────────────────────────────────────
// sandbox-twins.test.mjs — tooling/scripts/provision-sandbox-twins.mjs (create the
// platform's missing sandbox namespaces and bucket, record their ids) and
// tooling/scripts/wrangler-surgery.mjs (the structure-scoped writer both
// provisioners use). ⏱ 2026-10-01, rv2-services-011 / -022.
//
// No network: the Cloudflare API is a fake handed to provision(), and the CLI cases
// run with credentials stripped. What is held: create only, idempotent, sandbox
// names only, a recorded id never overwritten, every write re-parse-verified and
// confined to the one field, and the token never printed.
//
// Run:  node --test tooling/ci/test/sandbox-twins.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseJsonc } from '../d1-stores.mjs';
import {
  TWINS,
  declarationProblems,
  placements,
  provision,
  credentials,
  Refused,
} from '../../scripts/provision-sandbox-twins.mjs';
import {
  bindingField,
  isPlaceholderId,
  setEnvBindingField,
  topLevelEnvOffset,
  SurgeryRefused,
} from '../../scripts/wrangler-surgery.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'scripts', 'provision-sandbox-twins.mjs');
const PLATFORM = 'services/platform/wrangler.jsonc';
const API = 'services/subscriptiontracker-api/wrangler.jsonc';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-sbx-twins-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** A copy of every services/<dir> wrangler.jsonc as the tree holds them (the Worker set reads only those). */
function tree() {
  const root = join(TMP, `t${seq++}`);
  for (const dir of ['platform', 'subscriptiontracker-api', 'edge-shield']) {
    const rel = `services/${dir}/wrangler.jsonc`;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  mkdirSync(join(root, 'services', '_shared'), { recursive: true });
  return root;
}

/** A fake Cloudflare: KV namespaces and R2 buckets in memory, every call recorded. */
function fakeApi({ kv = [], r2 = [] } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    kv,
    r2,
    kvNamespaces: async () => { calls.push('GET kv'); return [...kv]; },
    createKv: async (title) => {
      calls.push(`POST kv ${title}`);
      const id = `${(++n).toString(16).padStart(2, '0')}`.padEnd(32, 'e');
      kv.push({ id, title });
      return { id, title };
    },
    r2Buckets: async () => { calls.push('GET r2'); return [...r2]; },
    createR2: async (name) => { calls.push(`POST r2 ${name}`); r2.push({ name }); return { name }; },
  };
}
const io = (root) => ({
  read: (rel) => readFileSync(join(root, rel), 'utf8'),
  write: (rel, text) => writeFileSync(join(root, rel), text),
});
const sbx = (root, rel, section, binding, field) =>
  bindingField(parseJsonc(readFileSync(join(root, rel), 'utf8')), { env: 'sandbox', section, binding, field });

describe('provision-sandbox-twins — the declaration', () => {
  test('every twin is in the sandbox naming space, kv or r2, each binding once', () => {
    assert.deepEqual(declarationProblems(), []);
    assert.ok(TWINS.every((t) => t.name.endsWith('-sandbox')));
  });

  test('🔴 RED: a production-shaped name, an unknown kind and a doubled binding are each refused', () => {
    const p = declarationProblems([
      { kind: 'kv', name: 'session-revoked', binding: 'A' },
      { kind: 'd1', name: 'x-sandbox', binding: 'B' },
      { kind: 'kv', name: 'y-sandbox', binding: 'B' },
    ]);
    assert.equal(p.length, 3, p.join('\n'));
    assert.match(p[0], /session-revoked: not in the sandbox naming space/);
    assert.match(p[1], /kind d1 is neither kv nor r2/);
    assert.match(p[2], /B: declared twice/);
  });

  test('the real tree: each twin lands in the configs whose env.sandbox binds it, and nowhere else', () => {
    const got = placements(REPO).map((p) => `${p.twin.binding} → ${p.config}`).sort();
    assert.deepEqual(got, [
      `BACKUPS_R2 → ${PLATFORM}`,
      `SESSION_REVOKED → ${PLATFORM}`,
      `SESSION_REVOKED → ${API}`,
      `SIGNUPS → ${PLATFORM}`,
    ]);
  });
});

describe('provision-sandbox-twins — plan, apply, and a second run', () => {
  test('PLAN (no --apply) reads the account and creates and writes NOTHING', async () => {
    const root = tree();
    const before = readFileSync(join(root, PLATFORM), 'utf8');
    const api = fakeApi();
    const out = await provision({ root, api, apply: false, ...io(root) });
    assert.deepEqual(api.calls, ['GET kv', 'GET r2']);
    assert.deepEqual(out.writes, []);
    assert.equal(readFileSync(join(root, PLATFORM), 'utf8'), before);
  });

  test('APPLY creates exactly the missing twins, writes ONE id per binding into every config, and changes nothing else', async () => {
    const root = tree();
    const beforeApi = parseJsonc(readFileSync(join(root, API), 'utf8'));
    const api = fakeApi();
    const out = await provision({ root, api, apply: true, ...io(root) });
    assert.deepEqual(api.calls, ['GET kv', 'GET r2', 'POST kv session-revoked-sandbox', 'POST kv signups-sandbox', 'POST r2 nikatru-backups-sandbox']);
    assert.deepEqual(out.writes.sort(), [PLATFORM, API].sort());
    const revoked = api.kv.find((k) => k.title === 'session-revoked-sandbox').id;
    assert.equal(sbx(root, PLATFORM, 'kv_namespaces', 'SESSION_REVOKED', 'id'), revoked);
    assert.equal(sbx(root, API, 'kv_namespaces', 'SESSION_REVOKED', 'id'), revoked, 'ONE revocation namespace for both sandbox Workers');
    assert.equal(sbx(root, PLATFORM, 'kv_namespaces', 'SIGNUPS', 'id'), api.kv.find((k) => k.title === 'signups-sandbox').id);
    // Production is untouched, byte for byte in parse.
    const afterApi = parseJsonc(readFileSync(join(root, API), 'utf8'));
    assert.deepEqual({ ...afterApi, env: undefined }, { ...beforeApi, env: undefined });
    assert.equal(bindingField(afterApi, { section: 'kv_namespaces', binding: 'SESSION_REVOKED', field: 'id' }), 'aa46ad5002874231931cc5dc5b6e2904');
  });

  test('IDEMPOTENT: a second run against the same account creates nothing and writes nothing', async () => {
    const root = tree();
    const api = fakeApi();
    await provision({ root, api, apply: true, ...io(root) });
    const snapshot = readFileSync(join(root, PLATFORM), 'utf8');
    api.calls.length = 0;
    const again = await provision({ root, api, apply: true, ...io(root) });
    assert.deepEqual(api.calls, ['GET kv', 'GET r2']);
    assert.deepEqual(again.writes, []);
    assert.equal(readFileSync(join(root, PLATFORM), 'utf8'), snapshot);
  });

  test('an EXISTING namespace with the twin title is reused, never duplicated', async () => {
    const root = tree();
    const api = fakeApi({ kv: [{ id: 'abcdefabcdefabcdefabcdefabcdef01', title: 'session-revoked-sandbox' }], r2: [{ name: 'nikatru-backups-sandbox' }] });
    await provision({ root, api, apply: true, ...io(root) });
    assert.deepEqual(api.calls, ['GET kv', 'GET r2', 'POST kv signups-sandbox']);
    assert.equal(sbx(root, API, 'kv_namespaces', 'SESSION_REVOKED', 'id'), 'abcdefabcdefabcdefabcdefabcdef01');
  });

  test('🔴 RED: a recorded id that differs from the account is NEVER overwritten — refused before any write', async () => {
    const root = tree();
    const t = readFileSync(join(root, API), 'utf8');
    writeFileSync(join(root, API), setEnvBindingField(t, { env: 'sandbox', section: 'kv_namespaces', binding: 'SESSION_REVOKED', field: 'id', value: '1234567890abcdef1234567890abcdef' }));
    const platformBefore = readFileSync(join(root, PLATFORM), 'utf8');
    const api = fakeApi({ kv: [{ id: 'abcdefabcdefabcdefabcdefabcdef01', title: 'session-revoked-sandbox' }] });
    await assert.rejects(
      provision({ root, api, apply: true, ...io(root) }),
      (e) => e instanceof Refused && /already names id #[0-9a-f]{8}, and the account's session-revoked-sandbox is #[0-9a-f]{8}[\s\S]*never overwrites/.test(e.message),
    );
    assert.equal(readFileSync(join(root, PLATFORM), 'utf8'), platformBefore, 'a refusal wrote a sibling config first');
  });

  test('🔴 RED: two namespaces with the twin title is a refusal, not a guess', async () => {
    const root = tree();
    const api = fakeApi({ kv: [{ id: 'a'.repeat(32), title: 'signups-sandbox' }, { id: 'b'.repeat(32), title: 'signups-sandbox' }] });
    await assert.rejects(provision({ root, api, apply: true, ...io(root) }), /2 KV namespaces are titled signups-sandbox/);
  });

  test('🔴 RED: a twin no env.sandbox binds would be created for nothing — refused', async () => {
    const root = tree();
    const t = readFileSync(join(root, PLATFORM), 'utf8');
    // In the env part only: the top level binds SIGNUPS too, earlier in the file.
    const cut = topLevelEnvOffset(t);
    writeFileSync(join(root, PLATFORM), t.slice(0, cut) + t.slice(cut).replace(/,(\s*(?:\/\/[^\n]*\n\s*)*)\{ "binding": "SIGNUPS", "id": "[0-9a-f]{32}" \}/, '$1'));
    assert.equal(sbx(root, PLATFORM, 'kv_namespaces', 'SIGNUPS', 'id'), undefined, 'fixture anchor: SIGNUPS still bound');
    await assert.rejects(provision({ root, api: fakeApi(), apply: true, ...io(root) }), /binds SIGNUPS, so signups-sandbox would be created for nothing/);
  });
});

describe('provision-sandbox-twins — the CLI and the token', () => {
  test('--list is offline and names every placement', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--list'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /kv session-revoked-sandbox +→ services\/subscriptiontracker-api\/wrangler\.jsonc env\.sandbox SESSION_REVOKED/);
  });

  // The CLI is never run without a flag here: on a machine holding the vault that is a
  // real (read-only) account call. The credential refusal is credentials()'s case below.
  test('an unknown flag is refused before any credential is read', () => {
    const u = spawnSync(process.execPath, [SCRIPT, '--force'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(u.status, 1);
    assert.match(u.stderr, /unknown argument\(s\) --force/);
  });

  test('the vault is read IN-PROCESS: the two keys only, quotes stripped, from the main checkout', () => {
    const root = join(TMP, `vault${seq++}`);
    mkdirSync(join(root, '.claude'), { recursive: true });
    assert.equal(spawnSync('git', ['-C', root, 'init', '-q']).status, 0);
    writeFileSync(
      join(root, '.claude', 'secrets.env'),
      '# comment\nOTHER_SECRET=nope\nCLOUDFLARE_API_TOKEN="tok-from-vault"\nCLOUDFLARE_ACCOUNT_ID=\'acct-from-vault\'\n',
    );
    const got = credentials(root, {});
    assert.deepEqual(got, { CLOUDFLARE_API_TOKEN: 'tok-from-vault', CLOUDFLARE_ACCOUNT_ID: 'acct-from-vault' });
    assert.equal(Object.hasOwn(got, 'OTHER_SECRET'), false);
    // The environment wins over the vault, key by key.
    assert.equal(credentials(root, { CLOUDFLARE_API_TOKEN: 'env-tok' }).CLOUDFLARE_API_TOKEN, 'env-tok');
    assert.throws(() => credentials(join(TMP, 'novault-nowhere'), {}), /not set in the environment and not found in/);
  });

  test('the script never prints a token: no `console.*(` line names it', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const printing = src.split('\n').filter((l) => /console\.(log|error)\(/.test(l) && /\btoken\b(?!:)/.test(l) && !/no token|never/.test(l));
    assert.deepEqual(printing, []);
  });
});

describe('wrangler-surgery — one field, by structure, proven by re-parse', () => {
  const CFG = `{
  // "env": { "sandbox": { "kv_namespaces": [ { "binding": "A", "id": "comment" } ] } }
  "name": "w",
  "kv_namespaces": [{ "binding": "A", "id": "prod-a" }, { "binding": "B", "id": "prod-b" }],
  "env": {
    "staging": {
      "kv_namespaces": [{ "binding": "A", "id": "stg-a" }],
      // A NESTED "sandbox" object, before the real one: only depth tells them apart.
      "meta": { "sandbox": { "kv_namespaces": [{ "binding": "A", "id": "nested-a" }] } }
    },
    "sandbox": {
      "vars": { "URL": "https://x//y" },
      "kv_namespaces": [
        { "binding": "A", "id": "${'0'.repeat(32)}" },
        // { "binding": "B", "id": "commented-out" },
        { "binding": "B", "id": "sbx-b" }
      ]
    }
  }
}
`;
  test('writes the named environment\'s entry only — not production, not another environment, not a comment', () => {
    const out = setEnvBindingField(CFG, { env: 'sandbox', section: 'kv_namespaces', binding: 'A', field: 'id', value: 'NEW' });
    const c = parseJsonc(out);
    assert.equal(bindingField(c, { env: 'sandbox', section: 'kv_namespaces', binding: 'A', field: 'id' }), 'NEW');
    assert.equal(bindingField(c, { section: 'kv_namespaces', binding: 'A', field: 'id' }), 'prod-a');
    assert.equal(bindingField(c, { env: 'staging', section: 'kv_namespaces', binding: 'A', field: 'id' }), 'stg-a');
    assert.equal(c.env.staging.meta.sandbox.kv_namespaces[0].id, 'nested-a', 'the nested look-alike was written');
    assert.ok(out.includes('"id": "comment"') && out.includes('"commented-out"'), 'a comment was rewritten');
    assert.equal(out.length, CFG.length - 32 + 3);
  });

  test('🔴 RED: an absent environment, section or binding, and a doubled binding, are refused', () => {
    const at = (o) => () => setEnvBindingField(CFG, { section: 'kv_namespaces', field: 'id', value: 'x', ...o });
    assert.throws(at({ env: 'prod', binding: 'A' }), (e) => e instanceof SurgeryRefused && /`env` declares no `prod` block/.test(e.message));
    assert.throws(at({ env: 'sandbox', section: 'd1_databases', binding: 'A' }), /env\.sandbox declares no `d1_databases` array/);
    assert.throws(at({ env: 'sandbox', binding: 'C' }), /0 entries are bound as C/);
    const doubled = CFG.replace('{ "binding": "B", "id": "sbx-b" }', '{ "binding": "A", "id": "dup" }');
    assert.throws(() => setEnvBindingField(doubled, { env: 'sandbox', section: 'kv_namespaces', binding: 'A', field: 'id', value: 'x' }), /2 entries are bound as A/);
    assert.throws(() => setEnvBindingField('{ "name": "w" }', { env: 'sandbox', section: 'kv_namespaces', binding: 'A', field: 'id', value: 'x' }), /declares no top-level `env` object/);
  });

  test('topLevelEnvOffset is the TOP-LEVEL "env" key, never one in a comment or a nested block', () => {
    const at = topLevelEnvOffset(CFG);
    assert.equal(CFG.slice(at, at + 5), '"env"');
    assert.ok(CFG.slice(0, at).includes('"prod-a"') && !CFG.slice(0, at).includes('"stg-a"'));
    assert.equal(topLevelEnvOffset('{ "name": "w", "vars": { "env": {} } }'), '{ "name": "w", "vars": { "env": {} } }'.length);
  });

  test('isPlaceholderId: both placeholder spellings, and nothing else', () => {
    assert.equal(isPlaceholderId('00000000-0000-0000-0000-000000000000'), true);
    assert.equal(isPlaceholderId('0'.repeat(32)), true);
    assert.equal(isPlaceholderId('b2acb786d12f4e36b339dd19f8812bbe'), false);
    assert.equal(isPlaceholderId(''), false);
    assert.equal(isPlaceholderId(undefined), false);
  });
});
