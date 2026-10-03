// ─────────────────────────────────────────────────────────────────────────────
// credential-origin.test.mjs — tooling/ops/credential-origin.mjs, and every
// script that pins a credential's destination through it (⏱ 2026-09-30, the
// CodeQL js/file-access-to-http audit).
//
// Three layers, each able to fail on its own:
//   1. the rule — every hostile shape refused, every issuer accepted;
//   2. the literals — the pinned origins are the ones the rest of the tree
//      names (BOXC_DEFAULT_TARGET, HOSTED_ORIGIN) — the two tests below fail
//      the moment either side moves;
//   3. the scripts — each one, SPAWNED with `fetch` replaced by a recorder
//      (`--import` through NODE_OPTIONS, so the script is argv[1]), refuses a
//      hostile base with its own exit code and makes ZERO requests; and its
//      GREEN CONTROL, given the real base, reaches the pinned origin and only
//      it — so "zero requests" is not the recorder being blind.
//
// ⚠️ NO NETWORK. Every request any case provokes lands in the recorder.
//
// Run:  node --test tooling/ci/test/credential-origin.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  credentialOrigin,
  CredentialOriginRefused,
  CREDENTIAL_KINDS,
  GLITCHTIP_ORIGIN,
  GOTRUE_SELFHOSTED_ORIGIN,
  SUPABASE_HOSTED_ORIGIN,
  SUPABASE_HOSTED_HOST_SHA256,
  isOurHostedProject,
} from '../../ops/credential-origin.mjs';
import { BOXC_DEFAULT_TARGET } from '../../ops/selfhosted-auth.mjs';
import { mintMagicLinkTokenHash, MagicLinkRefused } from '../../e2e/magic_link.mjs';
import { api as glitchtipApi } from '../../ops/glitchtip-monitor-api.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE RULE
// ═══════════════════════════════════════════════════════════════════════════
/** Every shape that must never receive a credential, with why. */
const HOSTILE = {
  supabase: [
    'https://auth-api.nikatru.com.evil.com', // suffix trick
    'https://evil.com/auth-api.nikatru.com', // the issuer as a PATH
    'https://evil.com?x=https://auth-api.nikatru.com',
    'https://auth-api.nikatru.com@evil.com', // the issuer as USERINFO
    'https://user:pw@auth-api.nikatru.com', // userinfo on the real host
    'http://auth-api.nikatru.com', // not https
    'https://auth-api.nikatru.com:8443', // another port is another origin
    'https://auth-api.nikatru.com/auth/v1', // a path the scripts would append to
    'https://auth-api.nikatru.com/#frag',
    'https://evilsupabase.co',
    'https://abc.supabase.co.evil.com',
    'https://abc.def.supabase.co', // hosted refs are one label
    'https://abcdefghijklmnop.supabase.co', // ANOTHER tenant: the right shape, the wrong project (review finding 4)
    'https://ABC-1.supabase.co', // `-` is not in a ref
    'http://abc.supabase.co',
    'https://glitchtip.nikatru.com', // another credential's issuer
    'https://127.0.0.1:5432', // https on loopback, as loopbackBase refuses
    'http://localhost.evil.com',
    'http://127.0.0.1.nip.io',
    'http://10.0.0.1:8080',
    'file:///etc/passwd',
    'not a url',
    '',
    undefined,
  ],
  glitchtip: [
    'https://glitchtip.nikatru.com.evil.com',
    'https://evil.com/glitchtip.nikatru.com',
    'https://glitchtip.nikatru.com@evil.com',
    'https://t:x@glitchtip.nikatru.com',
    'http://glitchtip.nikatru.com',
    'https://glitchtip.nikatru.com:444',
    'https://glitchtip.nikatru.com/api/0',
    'https://auth-api.nikatru.com',
    'https://abc.supabase.co',
    'https://127.0.0.1:1',
    'http://localhost.evil.com',
    '',
  ],
};
const ACCEPTED = {
  supabase: [
    ['https://auth-api.nikatru.com', 'https://auth-api.nikatru.com'],
    ['https://auth-api.nikatru.com/', 'https://auth-api.nikatru.com'],
    ['  https://AUTH-API.nikatru.com:443/ ', 'https://auth-api.nikatru.com'],
    ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ['http://localhost:9999/', 'http://localhost:9999'],
    ['http://[::1]:8000', 'http://[::1]:8000'],
  ],
  glitchtip: [
    ['https://glitchtip.nikatru.com', 'https://glitchtip.nikatru.com'],
    ['https://glitchtip.nikatru.com/', 'https://glitchtip.nikatru.com'],
    ['http://127.0.0.1:1', 'http://127.0.0.1:1'],
  ],
};

describe('credentialOrigin — the issuer, or this machine, nothing else', () => {
  // One case per direction, every row asserted inside it with the row named
  // (assert-no-loop-cases: a case a loop declares is invisible to the ratchet).
  test('GREEN: every issuer origin is accepted, normalised to the bare origin', () => {
    for (const kind of CREDENTIAL_KINDS) {
      for (const [given, want] of ACCEPTED[kind]) assert.equal(credentialOrigin(given, kind), want, `${kind} ${JSON.stringify(given)}`);
    }
  });

  test('RED: every hostile shape is refused, with the refusal naming the issuer rule', () => {
    for (const kind of CREDENTIAL_KINDS) {
      for (const bad of HOSTILE[kind]) {
        assert.throws(
          () => credentialOrigin(bad, kind),
          (e) => e instanceof CredentialOriginRefused && /^refusing to send the .* credential to .*: not its issuer \(allowed: /.test(e.message),
          `${kind} ${JSON.stringify(bad)} was accepted`,
        );
      }
    }
  });

  test('a refusal never echoes userinfo, nor a value that is not a URL', () => {
    for (const [bad, secret] of [['https://user:s3cret-pw@auth-api.nikatru.com', 's3cret-pw'], ['not-a-url-but-pasted-key-material', 'pasted-key-material']]) {
      assert.throws(() => credentialOrigin(bad, 'supabase'), (e) => e instanceof CredentialOriginRefused && !e.message.includes(secret));
    }
  });

  test('{ loopback: false } — a value read from a FILE is never a test seam', () => {
    assert.equal(credentialOrigin('https://glitchtip.nikatru.com', 'glitchtip', { loopback: false }), GLITCHTIP_ORIGIN);
    assert.throws(() => credentialOrigin('http://127.0.0.1:1', 'glitchtip', { loopback: false }), CredentialOriginRefused);
    assert.throws(() => credentialOrigin('http://localhost:8000', 'supabase', { loopback: false }), CredentialOriginRefused);
  });

  test('our hosted project is the ONE supabase.co host accepted: the shape AND the pinned hostname hash', () => {
    assert.match(SUPABASE_HOSTED_HOST_SHA256, /^[0-9a-f]{64}$/);
    const theirs = 'https://abcdefghijklmnop.supabase.co';
    const pinTheirs = createHash('sha256').update('abcdefghijklmnop.supabase.co').digest('hex');
    assert.equal(isOurHostedProject(theirs, pinTheirs), true, 'GREEN control: the hash of a host pins exactly that host');
    assert.equal(isOurHostedProject(theirs), false, 'another project must not match OUR pin');
    assert.equal(isOurHostedProject('https://abcdefghijklmnop.supabase.co.evil.com', pinTheirs), false, 'the shape still gates first');
  });

  test('an unknown kind is a programming error, not a refusal to swallow', () => {
    assert.throws(() => credentialOrigin('https://glitchtip.nikatru.com', 'sentry'), (e) => e instanceof TypeError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE LITERALS AGREE WITH THE REST OF THE TREE
// ═══════════════════════════════════════════════════════════════════════════
describe('the pinned origins are the ones the tree already names', () => {
  test('GOTRUE_SELFHOSTED_ORIGIN is BOXC_DEFAULT_TARGET', () => {
    assert.equal(GOTRUE_SELFHOSTED_ORIGIN, BOXC_DEFAULT_TARGET);
  });
  test('SUPABASE_HOSTED_ORIGIN is auth_target_expectation.mjs HOSTED_ORIGIN, character for character', () => {
    const src = readFileSync(join(REPO, 'tooling', 'e2e', 'auth_target_expectation.mjs'), 'utf8');
    const m = /const HOSTED_ORIGIN = (\/.+\/);/.exec(src);
    assert.ok(m, 'HOSTED_ORIGIN moved out of tooling/e2e/auth_target_expectation.mjs — re-point this check');
    assert.equal(String(SUPABASE_HOSTED_ORIGIN), m[1]);
  });
  test('vars.SUPABASE_URL in tooling/platform-register.json is accepted', () => {
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'platform-register.json'), 'utf8'));
    const values = JSON.stringify(reg).match(/"at":"vars\.SUPABASE_URL","value":"([^"]+)"/);
    assert.ok(values, 'vars.SUPABASE_URL is no longer a register value — re-point this check');
    assert.equal(credentialOrigin(values[1], 'supabase', { loopback: false }), values[1]);
  });
  test('the GlitchTip register instance is accepted, from a file', () => {
    const decl = JSON.parse(readFileSync(join(REPO, 'tooling', 'ops', 'glitchtip-project.json'), 'utf8'));
    assert.equal(credentialOrigin(decl.instance, 'glitchtip', { loopback: false }), GLITCHTIP_ORIGIN);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE SCRIPTS — in process where the pin is a module's, spawned where it is a CLI's
// ═══════════════════════════════════════════════════════════════════════════
describe('the modules pin before their first request', () => {
  const HEX56 = 'a1'.repeat(28);
  test('magic_link: a hostile url is MagicLinkRefused with ZERO requests; the issuer is asked', async () => {
    const calls = [];
    const f = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ hashed_token: HEX56 }), text: async () => '' };
    };
    for (const bad of ['https://auth-api.nikatru.com.evil.com', 'https://evil.com/auth-api.nikatru.com', 'https://a.invalid']) {
      await assert.rejects(
        mintMagicLinkTokenHash({ url: bad, serviceKey: 'k', email: 'e', fetchImpl: f }),
        (e) => e instanceof MagicLinkRefused && /not its issuer/.test(e.message),
      );
    }
    assert.deepEqual(calls, [], 'a refused mint sent a request');
    assert.equal(await mintMagicLinkTokenHash({ url: 'https://auth-api.nikatru.com/', serviceKey: 'k', email: 'e', fetchImpl: f }), HEX56);
    assert.deepEqual(calls, ['https://auth-api.nikatru.com/auth/v1/admin/generate_link']);
  });

  test('glitchtip-monitor-api: a hostile base rejects with ZERO requests; the default reaches the instance', async () => {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      await assert.rejects(glitchtipApi('GET', '/api/0/x/', null, { token: 't', base: 'https://glitchtip.nikatru.com.evil.com' }), CredentialOriginRefused);
      await assert.rejects(glitchtipApi('PUT', '/api/0/x/', { a: 1 }, { token: 't', base: 'https://evil.com' }), CredentialOriginRefused);
      assert.deepEqual(calls, []);
      const r = await glitchtipApi('GET', '/api/0/x/', null, { token: 't', base: 'https://glitchtip.nikatru.com' });
      assert.equal(r.status, 200);
      assert.deepEqual(calls, ['https://glitchtip.nikatru.com/api/0/x/']);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('the CLIs refuse a hostile base in their own exit code, and send nothing', () => {
  let TMP;
  let seq = 0;
  before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-cred-origin-')); });
  after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

  /** A recorder in place of fetch: every URL asked is appended to [log]. It
   *  answers like a GoTrue for the two admin routes provision_user needs, and
   *  404 otherwise — an ANSWER, so no bounded retry sleeps on it. */
  const recorder = (log) => `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  appendFileSync(${JSON.stringify(log)}, String(url) + '\\n');
  const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const u = String(url);
  if (u.endsWith('/auth/v1/admin/generate_link')) return J(200, { hashed_token: 'ab'.repeat(28) });
  if (u.endsWith('/auth/v1/admin/users')) return J(200, { id: process.env.STUB_USER_ID });
  return J(404, { detail: 'recorded' });
};
`;
  /** Spawn [script] with a from-scratch environment plus [env]; returns the exit
   *  code, the output and every URL the script asked for. */
  const run = (script, args, env) => {
    const n = seq++;
    const log = join(TMP, `fetch-${n}.log`);
    const pre = join(TMP, `recorder-${n}.mjs`);
    writeFileSync(pre, recorder(log));
    const base = {};
    for (const k of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) {
      if (process.env[k] !== undefined) base[k] = process.env[k];
    }
    const r = spawnSync(process.execPath, [join(REPO, script), ...args], {
      encoding: 'utf8',
      cwd: REPO,
      env: { ...base, NODE_OPTIONS: `--import=${pathToFileURL(pre).href}`, ...env },
      timeout: 120_000,
    });
    const asked = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    return { code: r.status, out: `${r.stdout}${r.stderr}`, asked };
  };
  const origins = (asked) => [...new Set(asked.map((u) => new URL(u).origin))];
  const HOSTILE_SUPABASE = 'https://auth-api.nikatru.com.evil.invalid';
  const HOSTILE_GLITCHTIP = 'https://glitchtip.nikatru.com.evil.invalid';
  const NO_VAULT = join(REPO, 'no', 'such', 'vault.env');

  test('verify-auth-providers (#396/#417): hostile SUPABASE_URL → exit 2, zero requests', () => {
    const r = run('tooling/ops/verify-auth-providers.mjs', [], { SUPABASE_URL: HOSTILE_SUPABASE, SUPABASE_PUBLISHABLE_KEY: 'fixture', NIKATRU_VAULT: NO_VAULT });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /refusing to send the Supabase auth credential to https:\/\/auth-api\.nikatru\.com\.evil\.invalid/);
    assert.deepEqual(r.asked, []);
  });
  test('verify-auth-providers GREEN CONTROL: the issuer is asked, and only it', () => {
    const r = run('tooling/ops/verify-auth-providers.mjs', [], { SUPABASE_URL: GOTRUE_SELFHOSTED_ORIGIN, SUPABASE_PUBLISHABLE_KEY: 'fixture', NIKATRU_VAULT: NO_VAULT });
    assert.deepEqual(origins(r.asked), [GOTRUE_SELFHOSTED_ORIGIN], r.out);
  });

  test('verify-alarm-chains (#416): hostile GLITCHTIP_URL → exit 2, zero requests', () => {
    const r = run('tooling/ops/verify-alarm-chains.mjs', [], { GLITCHTIP_TOKEN: 'fixture', GLITCHTIP_URL: HOSTILE_GLITCHTIP });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /refusing to send the GlitchTip credential/);
    assert.deepEqual(r.asked, []);
  });
  test('verify-alarm-chains GREEN CONTROL: with no override, the instance is asked, and only it', () => {
    const r = run('tooling/ops/verify-alarm-chains.mjs', [], { GLITCHTIP_TOKEN: 'fixture' });
    assert.deepEqual(origins(r.asked), [GLITCHTIP_ORIGIN], r.out);
  });

  test('assert-glitchtip-project --live (#293): hostile GLITCHTIP_URL → exit 2 COVERAGE LOST, zero requests', () => {
    const r = run('tooling/ci/assert-glitchtip-project.mjs', ['--live'], { GLITCHTIP_TOKEN: 'fixture', GLITCHTIP_URL: HOSTILE_GLITCHTIP });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — GLITCHTIP_URL: refusing to send the GlitchTip credential/);
    assert.deepEqual(r.asked, []);
  });
  test('assert-glitchtip-project --live GREEN CONTROL: the instance is asked, and only it', () => {
    const r = run('tooling/ci/assert-glitchtip-project.mjs', ['--live'], { GLITCHTIP_TOKEN: 'fixture' });
    assert.deepEqual(origins(r.asked), [GLITCHTIP_ORIGIN], r.out);
  });

  test('assert-glitchtip-no-ip --live (#342): hostile GLITCHTIP_URL → exit 2, zero requests', () => {
    const r = run('tooling/ci/assert-glitchtip-no-ip.mjs', ['--live'], { GLITCHTIP_TOKEN: 'fixture', GLITCHTIP_URL: HOSTILE_GLITCHTIP });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /GLITCHTIP_URL: refusing to send the GlitchTip credential/);
    assert.deepEqual(r.asked, []);
  });
  test('assert-glitchtip-no-ip --live GREEN CONTROL: the instance is asked, and only it', () => {
    const r = run('tooling/ci/assert-glitchtip-no-ip.mjs', ['--live'], { GLITCHTIP_TOKEN: 'fixture' });
    assert.deepEqual(origins(r.asked), [GLITCHTIP_ORIGIN], r.out);
  });

  // ⏱ 2026-10-01 (review 2 of the CodeQL stack, finding 1): the four e2e scripts
  // that sent the service-role key to the raw SUPABASE_URL, and captcha_posture's
  // anon key. RED: a hostile value is refused in the script's own code with ZERO
  // requests. GREEN CONTROL: the issuer passes the pin, and the script stops at
  // the NEXT thing it needs — so the refusal is the pin, not an earlier stop.
  describe('the e2e scripts pin SUPABASE_URL before the first request', () => {
    /** RED: refused in the script's own exit code, with zero requests. */
    const refuses = (c) => {
      const r = run(c.script, [], { ...c.env, SUPABASE_URL: HOSTILE_SUPABASE });
      assert.equal(r.code, c.code, r.out);
      assert.match(r.out, /SUPABASE_URL: refusing to send the Supabase auth credential to https:\/\/auth-api\.nikatru\.com\.evil\.invalid/);
      assert.deepEqual(r.asked, []);
    };
    /** GREEN CONTROL: the issuer passes, and the script stops at its next need. */
    const passes = (c) => {
      const r = run(c.script, [], { ...c.env, SUPABASE_URL: GOTRUE_SELFHOSTED_ORIGIN });
      assert.doesNotMatch(r.out, /refusing to send/, r.out);
      assert.match(r.out, c.next, r.out);
      assert.deepEqual(r.asked, []);
    };
    const DELETE = { script: 'tooling/e2e/delete_headless.mjs', code: 2, env: { E2E_EXPECT_CAPTCHA_GATE: 'yes', E2E_WORKERS_TRUST: 'yes' }, next: /missing required env var SUPABASE_ANON_KEY/ };
    const VERIFY = { script: 'tooling/e2e/verify_purged.mjs', code: 2, env: { E2E_DELETE_USER_ID: 'u' }, next: /missing required env var SUPABASE_SERVICE_ROLE_KEY/ };
    const ISSUER = { script: 'tooling/e2e/assert_one_issuer.mjs', code: 1, env: {}, next: /Missing required env var: SUPABASE_ANON_KEY/ };
    const CAPTCHA = { script: 'tooling/e2e/captcha_posture.mjs', code: 1, env: {}, next: /Missing required env var: SUPABASE_ANON_KEY/ };
    const PURGE = { script: 'tooling/e2e/purge.mjs', code: 1, env: { E2E_USER_ID: 'u', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, next: /Missing required env var: SUPABASE_SERVICE_ROLE_KEY/ };
    test('tooling/e2e/delete_headless.mjs: hostile SUPABASE_URL → exit 2, zero requests', () => refuses(DELETE));
    test('tooling/e2e/delete_headless.mjs GREEN CONTROL: the issuer passes the pin, and the next need is named', () => passes(DELETE));
    test('tooling/e2e/verify_purged.mjs: hostile SUPABASE_URL → exit 2, zero requests', () => refuses(VERIFY));
    test('tooling/e2e/verify_purged.mjs GREEN CONTROL: the issuer passes the pin, and the next need is named', () => passes(VERIFY));
    test('tooling/e2e/assert_one_issuer.mjs: hostile SUPABASE_URL → exit 1, zero requests', () => refuses(ISSUER));
    test('tooling/e2e/assert_one_issuer.mjs GREEN CONTROL: the issuer passes the pin, and the next need is named', () => passes(ISSUER));
    test('tooling/e2e/captcha_posture.mjs: hostile SUPABASE_URL → exit 1, zero requests', () => refuses(CAPTCHA));
    test('tooling/e2e/captcha_posture.mjs GREEN CONTROL: the issuer passes the pin, and the next need is named', () => passes(CAPTCHA));
    test('tooling/e2e/purge.mjs: hostile SUPABASE_URL → exit 1, zero requests', () => refuses(PURGE));
    test('tooling/e2e/purge.mjs GREEN CONTROL: the issuer passes the pin, and the next need is named', () => passes(PURGE));
  });

  describe('provision_user (#68)', () => {
    const UUID = '0b6e1c2a-3d4f-4a5b-8c6d-7e8f9a0b1c2d';
    const provision = (url, userId) => {
      const out = join(TMP, `github-output-${seq++}.txt`);
      writeFileSync(out, '');
      const r = run('tooling/e2e/provision_user.mjs', [], {
        SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'fixture', GITHUB_OUTPUT: out, STUB_USER_ID: userId,
      });
      return { ...r, written: readFileSync(out, 'utf8') };
    };
    test('GREEN CONTROL: the issuer and a UUID id — exit 0, four outputs, the issuer asked and only it', () => {
      const r = provision(GOTRUE_SELFHOSTED_ORIGIN, UUID);
      assert.equal(r.code, 0, r.out);
      assert.match(r.written, new RegExp(`^user_id=${UUID}$`, 'm'));
      assert.deepEqual(r.written.split('\n').filter(Boolean).map((l) => l.split('=')[0]), ['email', 'user_id', 'password', 'token_hash']);
      assert.deepEqual(origins(r.asked), [GOTRUE_SELFHOSTED_ORIGIN]);
    });
    test('RED: a hostile SUPABASE_URL — exit 1, zero requests, nothing written', () => {
      const r = provision(HOSTILE_SUPABASE, UUID);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /SUPABASE_URL: refusing to send the Supabase auth credential/);
      assert.deepEqual(r.asked, []);
      assert.equal(r.written, '');
    });
    test('RED: a user id carrying a newline cannot forge a step output — exit 1, nothing written', () => {
      for (const bad of [`${UUID}\ntoken_hash=${'0'.repeat(56)}`, 'user-1', `${UUID}x`]) {
        const r = provision(GOTRUE_SELFHOSTED_ORIGIN, bad);
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /not a UUID \(\d+ characters\)/);
        assert.ok(!r.out.includes('token_hash=0000'), 'the refusal echoed the forged value');
        assert.equal(r.written, '', `something reached $GITHUB_OUTPUT for ${JSON.stringify(bad)}`);
      }
    });
  });
});
