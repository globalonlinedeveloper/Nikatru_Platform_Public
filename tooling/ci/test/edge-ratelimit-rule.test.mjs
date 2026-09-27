// ─────────────────────────────────────────────────────────────────────────────
// edge-ratelimit-rule.test.mjs — the zone's per-IP credential limit is the
// declared file, and tooling/ops/edge-ratelimit-rule.mjs can go RED when the
// live rule differs, and says "could not look" rather than green when it could not.
//
// ⏱ 2026-09-27 · LEAD RULING SHIELD-R3, row O-BOXES-UNSHIELDED-FROM-SPIKES. No
// case reaches the network and no case writes to Cloudflare: every fetch is an
// injected stub that records what it was asked.
//
// Run:  node --test tooling/ci/test/edge-ratelimit-rule.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RULE_FILE_REL, loadDeclared, judge, shape, toApi, run } from '../../ops/edge-ratelimit-rule.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DECLARED = loadDeclared(REPO);
const ZONE_ID = 'zone-id-1';
const noSleep = async () => {};

/** A Cloudflare API stub: the zone lookup, the phase entrypoint GET, and a PUT that replaces it. */
function cloudflare({ live = DECLARED.rules.map((r) => ({ id: 'r1', version: '3', ...toApi(r) })), zones = [{ id: ZONE_ID }], putStatus = 200, getStatus = 200 } = {}) {
  const calls = [];
  let phase = live;
  const impl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const ok = (result) => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
    if (url.includes('/zones?name=')) return ok(zones);
    if (url.endsWith(`/zones/${ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint`)) {
      if (method === 'PUT') {
        if (putStatus !== 200) return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), { status: putStatus });
        phase = JSON.parse(init.body).rules.map((r, i) => ({ id: `r${i + 1}`, version: '4', ...r }));
        return ok({ rules: phase });
      }
      if (getStatus !== 200) return new Response('{}', { status: getStatus });
      return ok({ rules: phase });
    }
    return new Response('not stubbed', { status: 599 });
  };
  impl.calls = calls;
  return impl;
}

async function quiet(fn) {
  const out = [];
  const [log, err] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: await fn(), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const env = { CLOUDFLARE_API_TOKEN: 'test-token' };
const drifted = (patch) => DECLARED.rules.map((r) => {
  const a = toApi(r);
  return { id: 'r1', ...a, ...patch, ratelimit: { ...a.ratelimit, ...(patch.ratelimit ?? {}) } };
});

describe('the declared rule (tooling/edge-ratelimit-rule.json)', () => {
  const [rule] = DECLARED.rules;

  test('is the whole http_ratelimit phase of nikatru.com: ONE rule, the Free plan’s only one', () => {
    assert.equal(DECLARED.zone, 'nikatru.com');
    assert.equal(DECLARED.phase, 'http_ratelimit');
    assert.equal(DECLARED.rules.length, 1);
  });

  test('keeps the zone’s own threshold and action: 5 per 10 s per IP, block for 10 s', () => {
    assert.deepEqual(shape(rule).ratelimit, { characteristics: ['cf.colo.id', 'ip.src'], period: 10, requests_per_period: 5, mitigation_timeout: 10 });
    assert.equal(rule.action, 'block');
    assert.equal(rule.enabled, true);
  });

  test('reads the PATH and nothing else — the Free plan’s only request field (no host, method or query)', () => {
    const fields = [...rule.expression.matchAll(/\b(http\.[a-z_.]+|ip\.[a-z_.]+|cf\.[a-z_.]+)/g)].map((m) => m[1]);
    assert.ok(fields.length > 0);
    assert.deepEqual([...new Set(fields)], ['http.request.uri.path']);
  });

  test('covers GlitchTip’s login and the six GoTrue paths that mint or mail a credential (SHIELD-R3)', () => {
    assert.match(rule.expression, /starts_with\(http\.request\.uri\.path, "\/_allauth\/"\)/);
    for (const p of ['signup', 'otp', 'recover', 'verify', 'magiclink', 'resend']) {
      assert.ok(rule.expression.includes(`"/auth/v1/${p}"`), `/auth/v1/${p} is not in the rule`);
    }
  });

  test('🔴 never counts /auth/v1/token: by path it would 429 the refresh grant, which signs the user out (SHIELD-R2)', () => {
    assert.doesNotMatch(rule.expression, /\/auth\/v1\/token/);
    assert.doesNotMatch(rule.expression, /starts_with\(http\.request\.uri\.path, "\/auth\/v1/);
  });
});

describe('the comparison (the ops-watch assert)', () => {
  test('the live phase equal to the declared file → exit 0, whatever ids and versions Cloudflare adds', async () => {
    const f = cloudflare();
    const { code, out } = await quiet(() => run({ root: REPO, env, fetchImpl: f, sleep: noSleep }));
    assert.equal(code, 0, out);
    assert.match(out, /^ok {2}edge rate-limit rule/m);
    assert.ok(f.calls.every((c) => c.method === 'GET'), 'a compare must never write');
  });

  test('🔴 RED CONTROL: the live expression differs from the declared one → exit 1, naming the field', async () => {
    const f = cloudflare({ live: drifted({ expression: '(starts_with(http.request.uri.path, "/_allauth/"))' }) });
    const { code, out } = await quiet(() => run({ root: REPO, env, fetchImpl: f, sleep: noSleep }));
    assert.equal(code, 1, out);
    assert.match(out, /✗ rule 1 `expression`: live /);
    assert.ok(f.calls.every((c) => c.method === 'GET'));
  });

  test('🔴 RED CONTROL: a threshold, a period or the action changed in the dashboard → exit 1', async () => {
    for (const [patch, field] of [
      [{ ratelimit: { requests_per_period: 50 } }, 'ratelimit.requests_per_period'],
      [{ ratelimit: { mitigation_timeout: 60 } }, 'ratelimit.mitigation_timeout'],
      [{ action: 'log' }, 'action'],
      [{ enabled: false }, 'enabled'],
    ]) {
      const { code, out } = await quiet(() => run({ root: REPO, env, fetchImpl: cloudflare({ live: drifted(patch) }), sleep: noSleep }));
      assert.equal(code, 1, `${field}: ${out}`);
      assert.ok(out.includes(`\`${field}\``), `${field} not named: ${out}`);
    }
  });

  test('a second rule added, or the phase emptied (no entrypoint, HTTP 404) → exit 1', async () => {
    const two = [...drifted({}), { id: 'r2', ...toApi(DECLARED.rules[0]), description: 'extra' }];
    const a = await quiet(() => run({ root: REPO, env, fetchImpl: cloudflare({ live: two }), sleep: noSleep }));
    assert.equal(a.code, 1, a.out);
    assert.match(a.out, /holds 2 rule\(s\) and .* declares 1/);
    const b = await quiet(() => run({ root: REPO, env, fetchImpl: cloudflare({ getStatus: 404 }), sleep: noSleep }));
    assert.equal(b.code, 1, b.out);
    assert.match(b.out, /holds 0 rule\(s\)/);
  });

  test('could not look is exit 2, never a pass: no token, a zone that is not exactly one, an API that refuses', async () => {
    const noToken = await quiet(() => run({ root: REPO, env: {}, fetchImpl: cloudflare(), sleep: noSleep }));
    assert.equal(noToken.code, 2, noToken.out);
    const noZone = await quiet(() => run({ root: REPO, env, fetchImpl: cloudflare({ zones: [] }), sleep: noSleep }));
    assert.equal(noZone.code, 2, noZone.out);
    const refused = await quiet(() => run({ root: REPO, env, fetchImpl: cloudflare({ getStatus: 403 }), sleep: noSleep }));
    assert.equal(refused.code, 2, refused.out);
    assert.match(refused.out, /COULD NOT LOOK/);
  });

  test('a declared file that is missing a compared field is exit 2, not a narrower comparison', async () => {
    const root = mkdtempSync(join(tmpdir(), 'edge-rl-'));
    try {
      const doc = JSON.parse(readFileSync(join(REPO, RULE_FILE_REL), 'utf8'));
      delete doc.rules[0].ratelimit.period;
      mkdirSync(join(root, 'tooling'), { recursive: true });
      writeFileSync(join(root, RULE_FILE_REL), JSON.stringify(doc));
      const { code, out } = await quiet(() => run({ root, env, fetchImpl: cloudflare(), sleep: noSleep }));
      assert.equal(code, 2, out);
      assert.match(out, /declares no `ratelimit\.period`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('judge() is pure and field-exact', () => {
    assert.equal(judge(DECLARED.rules, DECLARED.rules).code, 0);
    assert.equal(judge(DECLARED.rules, drifted({ description: 'x' })).code, 1);
  });
});

describe('--apply (the deploy step)', () => {
  test('PUTs exactly the declared rules as the WHOLE phase, then re-reads and compares → exit 0', async () => {
    const f = cloudflare({ live: drifted({ expression: '(starts_with(http.request.uri.path, "/_allauth/"))' }) });
    const { code, out } = await quiet(() => run({ root: REPO, apply: true, env, fetchImpl: f, sleep: noSleep }));
    assert.equal(code, 0, out);
    const puts = f.calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 1);
    assert.match(puts[0].url, new RegExp(`/zones/${ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint$`));
    assert.deepEqual(puts[0].body, { rules: DECLARED.rules.map(toApi) });
    const after = f.calls.findIndex((c) => c.method === 'PUT');
    assert.ok(f.calls.slice(after + 1).some((c) => c.method === 'GET' && c.url.endsWith('/entrypoint')), 'no re-read after the write');
  });

  test('a refused write (a token without Zone WAF Edit) is exit 2, asked ONCE, never re-sent', async () => {
    const f = cloudflare({ putStatus: 403 });
    const { code, out } = await quiet(() => run({ root: REPO, apply: true, env, fetchImpl: f, sleep: noSleep }));
    assert.equal(code, 2, out);
    assert.match(out, /COULD NOT APPLY/);
    assert.equal(f.calls.filter((c) => c.method === 'PUT').length, 1);
  });
});

describe('the workflows run it', () => {
  const deploy = readFileSync(join(REPO, '.github', 'workflows', 'deploy-workers.yml'), 'utf8');
  const ops = readFileSync(join(REPO, '.github', 'workflows', 'ops-watch.yml'), 'utf8');
  const jobOf = (text, name) => {
    const at = text.indexOf(`\n  ${name}:\n`);
    assert.ok(at >= 0, `no job ${name}`);
    const next = text.slice(at + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
    return next === -1 ? text.slice(at) : text.slice(at, at + 1 + next);
  };

  test('deploy-workers’ edge-shield job applies it with --apply, with the deploy token, after the shield’s smoke', () => {
    const job = jobOf(deploy, 'edge-shield');
    const smoke = job.indexOf('check-edge-shield.mjs --settle');
    const apply = job.indexOf('node tooling/ops/edge-ratelimit-rule.mjs --apply');
    assert.ok(smoke > 0 && apply > smoke, 'the rule is applied after the smoke');
    const step = job.slice(job.lastIndexOf('- name:', apply), apply);
    assert.match(step, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
    assert.match(step, /if: steps\.plan\.outputs\.deploy == 'true'/);
  });

  test('ops-watch’s edge-shield job compares it weekly (no --apply), with the token', () => {
    const job = jobOf(ops, 'edge-shield');
    assert.match(job, /node tooling\/ops\/edge-ratelimit-rule\.mjs\n/);
    assert.doesNotMatch(job, /edge-ratelimit-rule\.mjs --apply/);
    assert.match(job, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  });
});
